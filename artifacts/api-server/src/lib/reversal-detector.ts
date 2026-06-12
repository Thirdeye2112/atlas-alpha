/**
 * reversal-detector.ts
 * --------------------
 * Detects when an open position should be flipped to the opposite direction.
 *
 * Scoring system (threshold: 50 points to trigger a flip):
 *   Jarvis cross (OMNI above/below flip)       40 pts
 *   Atlas Score direction flip                 30 pts
 *   ML conditional prob >65% opposite dir      25 pts
 *   Volume climax against position             20 pts
 *   Failed target (T1 hit → reversed to entry) 20 pts
 *   Bearish/bullish reversal candle            15 pts
 */

import { Pool } from "pg";
import type { PaperTrade } from "@workspace/db";
import type { AnalysisResult } from "./analysisEngine.js";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReversalSignalFired {
  name:   string;
  points: number;
  detail: string;
}

export interface ReversalResult {
  shouldFlip:    boolean;
  confidence:    number;   // 0–100 (equals totalPoints, capped at 100)
  totalPoints:   number;
  signals:       ReversalSignalFired[];
  newDirection:  "bullish" | "bearish";
  reason:        string;
}

// ── Candle pattern lists ──────────────────────────────────────────────────────

const BEARISH_REVERSAL = [
  "bearish engulfing", "shooting star", "hanging man", "evening star",
  "evening doji star", "dark cloud cover", "bearish harami", "gravestone doji",
  "three black crows", "bearish marubozu", "distribution top",
];

const BULLISH_REVERSAL = [
  "bullish engulfing", "hammer", "morning star", "morning doji star",
  "bullish harami", "dragonfly doji", "three white soldiers",
  "bullish marubozu", "piercing line", "bullish inv hammer",
  "capitulation",
];

// ── Research DB pool (lazy) ───────────────────────────────────────────────────

let _resPool: Pool | null = null;

function getResPool(): Pool {
  if (!_resPool) {
    const url = process.env["DATABASE_URL_RESEARCH"];
    if (!url) throw new Error("DATABASE_URL_RESEARCH not set");
    _resPool = new Pool({ connectionString: url, max: 2 });
    _resPool.on("error", (err) => logger.error({ err }, "[reversal] research pool error"));
  }
  return _resPool;
}

interface MLSnapshot {
  omniAbove:           number | null;
  mlDirection:         string | null;
  probabilityPositive: number | null;
}

async function fetchMLSnapshot(ticker: string): Promise<MLSnapshot> {
  try {
    const pool = getResPool();
    const c = await pool.connect();
    try {
      const [fsRes, predRes] = await Promise.all([
        c.query(
          `SELECT feature_value FROM feature_snapshots
           WHERE ticker = $1 AND feature_name = 'omni_82_above'
           ORDER BY snapshot_date DESC LIMIT 1`,
          [ticker],
        ),
        c.query(
          `SELECT ml_direction, probability_positive FROM predictions
           WHERE ticker = $1 AND model_name = 'return_regressor'
           ORDER BY date DESC LIMIT 1`,
          [ticker],
        ),
      ]);
      return {
        omniAbove:           fsRes.rows[0]?.feature_value  ?? null,
        mlDirection:         predRes.rows[0]?.ml_direction ?? null,
        probabilityPositive: predRes.rows[0]?.probability_positive != null
          ? Number(predRes.rows[0].probability_positive) : null,
      };
    } finally {
      c.release();
    }
  } catch (err) {
    logger.debug({ err, ticker }, "[reversal] fetchMLSnapshot failed, using nulls");
    return { omniAbove: null, mlDirection: null, probabilityPositive: null };
  }
}

// ── Main detector ─────────────────────────────────────────────────────────────

const FLIP_THRESHOLD = 50; // minimum cumulative points

export async function detectReversal(
  trade: PaperTrade,
  analysis: AnalysisResult,
): Promise<ReversalResult> {
  const isLong = trade.entryDirection !== "bearish";
  const price  = analysis.quote.price as number;
  const signals: ReversalSignalFired[] = [];
  let totalPoints = 0;

  const fire = (name: string, points: number, detail: string) => {
    signals.push({ name, points, detail });
    totalPoints += points;
  };

  // ── 1. Jarvis / OMNI cross — 40 pts ─────────────────────────────────────
  const ml = await fetchMLSnapshot(trade.ticker);
  if (ml.omniAbove != null) {
    const aboveOmni = Number(ml.omniAbove) > 0.5;
    if (isLong  && !aboveOmni) fire("jarvis_cross", 40, `Price crossed below OMNI (EMA82-low) — Jarvis bearish`);
    if (!isLong &&  aboveOmni) fire("jarvis_cross", 40, `Price crossed above OMNI (EMA82-low) — Jarvis bullish`);
  }

  // ── 2. Atlas Score direction flip — 30 pts ───────────────────────────────
  const dir = analysis.atlasScore.direction;
  if (isLong  && dir === "bearish") fire("atlas_direction_flip", 30, `Atlas direction flipped bearish (score ${analysis.atlasScore.overall})`);
  if (!isLong && dir === "bullish") fire("atlas_direction_flip", 30, `Atlas direction flipped bullish (score ${analysis.atlasScore.overall})`);

  // ── 3. ML conditional probability >65% opposite — 25 pts ─────────────────
  if (ml.probabilityPositive != null) {
    const prob = ml.probabilityPositive;
    if (isLong  && prob < 0.35) fire("ml_prob_opposite", 25, `ML P(bearish) = ${Math.round((1 - prob) * 100)}% — above 65% threshold`);
    if (!isLong && prob > 0.65) fire("ml_prob_opposite", 25, `ML P(bullish) = ${Math.round(prob * 100)}% — above 65% threshold`);
  }

  // ── 4. Volume climax against position — 20 pts ───────────────────────────
  const relVol     = analysis.volume.relativeVolume;
  const openPrice  = (analysis.quote.open as number | undefined) ?? price;
  const isRedBar   = price < openPrice;
  const isGreenBar = price > openPrice;
  if (relVol >= 2.5) {
    if (isLong  && isRedBar)   fire("volume_climax", 20, `Volume climax ${relVol.toFixed(1)}× — red bar against long`);
    if (!isLong && isGreenBar) fire("volume_climax", 20, `Volume climax ${relVol.toFixed(1)}× — green bar against short`);
  }

  // ── 5. Failed target: T1 hit then reversed to entry — 20 pts ─────────────
  if (trade.t1Hit) {
    const nearEntry = isLong
      ? price <= trade.entryPrice * 1.005   // long: price fell back to entry zone
      : price >= trade.entryPrice * 0.995;  // short: price rose back to entry zone
    if (nearEntry) fire("failed_target", 20, `T1 hit but price reverted to entry ($${trade.entryPrice.toFixed(2)})`);
  }

  // ── 6. Reversal candle opposite direction — 15 pts ───────────────────────
  const patterns = (analysis.patterns?.patterns ?? []) as string[];
  if (isLong) {
    const hit = patterns.find(p => BEARISH_REVERSAL.some(b => p.toLowerCase().includes(b)));
    if (hit) fire("reversal_candle", 15, `Bearish reversal candle: ${hit}`);
  } else {
    const hit = patterns.find(p => BULLISH_REVERSAL.some(b => p.toLowerCase().includes(b)));
    if (hit) fire("reversal_candle", 15, `Bullish reversal candle: ${hit}`);
  }

  const shouldFlip   = totalPoints >= FLIP_THRESHOLD;
  const confidence   = Math.min(100, totalPoints);
  const newDirection = isLong ? "bearish" : "bullish";
  const reason       = signals.map(s => s.name).join("+") || "none";

  if (shouldFlip) {
    logger.info(
      { ticker: trade.ticker, totalPoints, confidence, signals: signals.map(s => s.name), newDirection },
      "Reversal detected — position flip candidate",
    );
  }

  return { shouldFlip, confidence, totalPoints, signals, newDirection, reason };
}

// ── ATR + target computation (mirrors /api/targets logic) ────────────────────
// Used to generate fresh stop/T1/T2/T3 for the flipped position without an HTTP round-trip.

let _alphaPool: Pool | null = null;

function getAlphaPool(): Pool {
  if (!_alphaPool) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL not set");
    _alphaPool = new Pool({ connectionString: url, max: 2 });
    _alphaPool.on("error", (err) => logger.error({ err }, "[reversal] alpha pool error"));
  }
  return _alphaPool;
}

export interface FlipTargets {
  stopPrice:   number;
  targetPrice: number;
  t1Price:     number;
  t2Price:     number;
  t3Price:     number;
  atrPct:      number;
  trigger:     string;
}

export async function computeFlipTargets(
  ticker: string,
  price: number,
  direction: "bullish" | "bearish",
): Promise<FlipTargets | null> {
  try {
    const pool = getAlphaPool();
    const c = await pool.connect();
    let bars: { high: number; low: number; close: number }[] = [];
    try {
      const res = await c.query<{ high: string; low: string; close: string }>(
        `SELECT high::float AS high, low::float AS low, close::float AS close
         FROM ohlcv_history
         WHERE ticker = $1 AND interval = '1d'
         ORDER BY date DESC LIMIT 20`,
        [ticker],
      );
      bars = res.rows.map(r => ({ high: Number(r.high), low: Number(r.low), close: Number(r.close) })).reverse();
    } finally {
      c.release();
    }
    if (bars.length < 5) return null;

    // Wilder ATR-14
    const trs: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close;
      const { high, low } = bars[i];
      trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
    }
    const period = Math.min(14, trs.length);
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;

    const sign   = direction === "bullish" ? 1 : -1;
    const atrPct = (atr / price) * 100;

    return {
      stopPrice:   Math.round((price - sign * 0.75 * atr) * 100) / 100,
      targetPrice: Math.round((price + sign * 3.0  * atr) * 100) / 100,
      t1Price:     Math.round((price + sign * 1.5  * atr) * 100) / 100,
      t2Price:     Math.round((price + sign * 3.0  * atr) * 100) / 100,
      t3Price:     Math.round((price + sign * 5.0  * atr) * 100) / 100,
      atrPct,
      trigger:     "reversal_flip",
    };
  } catch (err) {
    logger.error({ err, ticker }, "[reversal] computeFlipTargets failed");
    return null;
  }
}
