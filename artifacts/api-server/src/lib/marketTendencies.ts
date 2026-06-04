import NodeCache from "node-cache";
import { fetchOHLCV } from "./marketData.js";
import type { OHLCVBar } from "./marketData.js";
import { logger } from "./logger.js";

const tendencyCache = new NodeCache({ stdTTL: 300 }); // 5-min cache

// ─── Types ─────────────────────────────────────────────────────────────────

export interface StreakInfo {
  direction: "up" | "down" | "flat";
  count: number;
  label: string;
  alert: string | null;
}

export interface StreakStatRow {
  consecutiveDays: number;
  pNextReversal: number;
  pNextContinuation: number;
  n: number;
  sampleSize: "small" | "moderate" | "large";
}

export interface OmniSignal {
  signal: "GREEN" | "YELLOW" | "RED";
  strength: "strong" | "moderate" | "weak";
  weeklyTrend: "bullish" | "bearish" | "neutral";
  reason: string;
  actionNote: string;
}

export interface IndexTendency {
  ticker: string;
  name: string;
  currentPrice: number;
  dayChangePct: number;
  streak: StreakInfo;
  priceVsSma50Pct: number;
  priceVsSma200Pct: number;
  rsi14: number;
  recentCloses: number[];
  omni: OmniSignal;
}

export interface MarketRule {
  id: string;
  name: string;
  category: string;
  description: string;
  status: "triggered" | "approaching" | "watch" | "inactive";
  currentValue: string;
  threshold: string;
  historicalEdge: string;
  actionNote: string;
  source: string;
}

export interface MarketTendenciesResult {
  indices: IndexTendency[];
  streakStats: {
    ticker: string;
    down: StreakStatRow[];
    up: StreakStatRow[];
  };
  marketRules: MarketRule[];
  analyzedAt: string;
}

// ─── Index Definitions ─────────────────────────────────────────────────────

const INDICES = [
  { ticker: "SPY",  name: "S&P 500"      },
  { ticker: "QQQ",  name: "Nasdaq 100"   },
  { ticker: "IWM",  name: "Russell 2000" },
  { ticker: "DIA",  name: "Dow Jones"    },
] as const;

// ─── Streak Calculation ─────────────────────────────────────────────────────

function calcStreak(bars: OHLCVBar[]): { direction: "up" | "down" | "flat"; count: number } {
  if (bars.length < 2) return { direction: "flat", count: 1 };

  const n = bars.length;
  const lastChange = bars[n - 1].close - bars[n - 2].close;

  if (Math.abs(lastChange) < 0.001) return { direction: "flat", count: 1 };

  const direction: "up" | "down" = lastChange > 0 ? "up" : "down";
  let count = 1;

  for (let i = n - 2; i >= 1; i--) {
    const chg = bars[i].close - bars[i - 1].close;
    const d = chg > 0 ? "up" : "down";
    if (d !== direction) break;
    count++;
  }

  return { direction, count };
}

function streakLabel(s: ReturnType<typeof calcStreak>): string {
  if (s.direction === "flat") return "Flat day";
  const arrow = s.direction === "up" ? "▲" : "▼";
  return `${arrow} ${s.count} consecutive ${s.direction} day${s.count > 1 ? "s" : ""}`;
}

function streakAlert(s: ReturnType<typeof calcStreak>): string | null {
  if (s.direction === "down") {
    if (s.count >= 5) return `⚠️ ${s.count} consecutive down days — historical reversal rate >90%`;
    if (s.count === 4) return `Approaching 5-day rule — mean reversion setup building`;
    if (s.count === 3) return `3 down days — watch for exhaustion / bounce signals`;
  }
  if (s.direction === "up") {
    if (s.count >= 6) return `Extended rally (${s.count} up days) — consider taking profits / raising stops`;
    if (s.count === 5) return `5 consecutive up days — overbought risk, watch for distribution`;
  }
  return null;
}

// ─── Historical Streak Stats ────────────────────────────────────────────────

function calcStreakStats(bars: OHLCVBar[], forDirection: "down" | "up", maxLen = 6): StreakStatRow[] {
  const rows: StreakStatRow[] = [];

  for (let streakLen = 1; streakLen <= maxLen; streakLen++) {
    let n = 0;
    let reversals = 0;

    for (let i = streakLen; i < bars.length - 1; i++) {
      // All streakLen days must be in the target direction
      let isStreak = true;
      for (let j = i; j > i - streakLen; j--) {
        const chg = bars[j].close - bars[j - 1].close;
        if (forDirection === "down" && chg >= 0) { isStreak = false; break; }
        if (forDirection === "up"   && chg <= 0) { isStreak = false; break; }
      }
      if (!isStreak) continue;

      // Day before must NOT be the same direction (exact streak length)
      const beforeIdx = i - streakLen;
      if (beforeIdx >= 1) {
        const beforeChg = bars[beforeIdx].close - bars[beforeIdx - 1].close;
        if (forDirection === "down" && beforeChg < 0) continue;
        if (forDirection === "up"   && beforeChg > 0) continue;
      }

      n++;
      const nextChg = bars[i + 1].close - bars[i].close;
      if (forDirection === "down" && nextChg > 0) reversals++;
      if (forDirection === "up"   && nextChg < 0) reversals++;
    }

    if (n >= 2) {
      rows.push({
        consecutiveDays: streakLen,
        pNextReversal:      n > 0 ? Math.round((reversals / n) * 1000) / 1000 : 0,
        pNextContinuation:  n > 0 ? Math.round(((n - reversals) / n) * 1000) / 1000 : 0,
        n,
        sampleSize: n < 8 ? "small" : n < 25 ? "moderate" : "large",
      });
    }
  }

  return rows;
}

// ─── Simple Indicators ──────────────────────────────────────────────────────

function sma(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI14(closes: number[]): number {
  if (closes.length < 15) return 50;
  const period = 14;
  const changes = closes.slice(-period - 1).map((c, i, arr) => (i === 0 ? 0 : c - arr[i - 1])).slice(1);
  const gains = changes.map(c => (c > 0 ? c : 0));
  const losses = changes.map(c => (c < 0 ? -c : 0));
  const avgGain = gains.reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

// ─── OMNI Signal ────────────────────────────────────────────────────────────
//
// Oscar Carboni's OMNI concept: multi-timeframe directional bias.
//   GREEN  = bullish bias — expect upward direction, buy dips
//   RED    = bearish bias — expect downward direction, sell rallies
//   YELLOW = at decision point or mixed — wait for confirmation
//
// Our implementation uses:
//   • Weekly trend proxy: price vs 50-day SMA (≈ 10-week SMA)
//   • Long-term context: 200-day SMA
//   • Streak: current consecutive day run
//   • RSI: momentum health
//

function calcOmni(
  bars: OHLCVBar[],
  streak: ReturnType<typeof calcStreak>,
  priceVsSma50Pct: number,
  priceVsSma200Pct: number,
  rsi: number
): OmniSignal {
  const weeklyTrend: OmniSignal["weeklyTrend"] =
    priceVsSma50Pct > 1.5  ? "bullish" :
    priceVsSma50Pct < -1.5 ? "bearish" : "neutral";

  const aboveLongTerm = priceVsSma200Pct > 0;
  const streakCount   = streak.count;
  const streakDir     = streak.direction;

  // GREEN: weekly trend up + (pullback = buy opportunity) or (early momentum)
  const isPullbackInUptrend  = weeklyTrend === "bullish" && streakDir === "down" && streakCount <= 4;
  const isEarlyMomentum      = weeklyTrend === "bullish" && streakDir === "up"   && streakCount <= 3 && rsi < 72;
  const isBounceConfirm      = weeklyTrend === "bullish" && streakDir === "up"   && streakCount === 1;

  // RED: weekly trend down + (bounce = sell opportunity) or (early decline)
  const isBounceInDowntrend  = weeklyTrend === "bearish" && streakDir === "up"   && streakCount <= 4;
  const isEarlyDecline       = weeklyTrend === "bearish" && streakDir === "down" && streakCount <= 3 && rsi > 28;

  // EXHAUSTION override — extreme streak flips OMNI to caution regardless of trend
  const isExhausted = streakCount >= 5;

  // YELLOW: at the 50d SMA decision point, or exhausted, or neutral trend
  const atDecisionPoint = Math.abs(priceVsSma50Pct) <= 1.5;

  let signal: OmniSignal["signal"];
  let strength: OmniSignal["strength"];
  let reason: string;
  let actionNote: string;

  if (isExhausted) {
    // Override to caution
    signal = "YELLOW";
    strength = "moderate";
    reason = `${streakCount} consecutive ${streakDir} days — exhaustion risk`;
    actionNote = streakDir === "down"
      ? `Mean reversion setup: >90% historical reversal rate after 5+ down days. Watch for bounce signal.`
      : `Extended rally: raising stops, watching for distribution / reversal.`;
  } else if (isPullbackInUptrend || isEarlyMomentum || isBounceConfirm) {
    signal = "GREEN";
    strength = aboveLongTerm ? "strong" : "moderate";
    if (isPullbackInUptrend) {
      reason = `Weekly trend BULLISH (+${priceVsSma50Pct.toFixed(1)}% vs 50d SMA). ${streakCount}-day pullback into support.`;
      actionNote = `OMNI: Buy dips. Pullback into ${aboveLongTerm ? "uptrend support above 200d SMA" : "50d SMA support"} — long entries favored.`;
    } else {
      reason = `Weekly trend BULLISH. ${streakCount}-day advance with RSI ${rsi} — momentum healthy.`;
      actionNote = `OMNI: Trend continuation mode. Hold longs, add on pullbacks to 50d SMA.`;
    }
  } else if (isBounceInDowntrend || isEarlyDecline) {
    signal = "RED";
    strength = !aboveLongTerm ? "strong" : "moderate";
    if (isBounceInDowntrend) {
      reason = `Weekly trend BEARISH (${priceVsSma50Pct.toFixed(1)}% vs 50d SMA). ${streakCount}-day bounce — sell opportunity.`;
      actionNote = `OMNI: Sell rallies. ${!aboveLongTerm ? "Below 200d SMA — structural downtrend." : "Below 50d SMA — defensive posture."} Short entries / reduce longs on strength.`;
    } else {
      reason = `Weekly trend BEARISH. ${streakCount}-day decline with RSI ${rsi} — momentum deteriorating.`;
      actionNote = `OMNI: Remain defensive. Rally attempts likely to fail near 50d SMA resistance.`;
    }
  } else {
    signal = "YELLOW";
    strength = "weak";
    if (atDecisionPoint) {
      reason = `Price at 50d SMA decision point (${priceVsSma50Pct >= 0 ? "+" : ""}${priceVsSma50Pct.toFixed(1)}%). Trend direction unclear.`;
      actionNote = `OMNI: Wait for directional confirmation. Break above 50d SMA = GREEN; break below = RED.`;
    } else if (weeklyTrend === "bullish" && streakDir === "up" && streakCount > 3) {
      reason = `Bullish trend but extended (${streakCount} up days, RSI ${rsi}). Caution zone.`;
      actionNote = `OMNI: Trend intact but overextended. Tighten stops, reduce new long exposure.`;
    } else {
      reason = `Mixed signals — weekly trend ${weeklyTrend}, ${streakLabel({ direction: streakDir, count: streakCount })}.`;
      actionNote = `OMNI: No clear edge. Reduce size, wait for setup alignment.`;
    }
  }

  return { signal, strength, weeklyTrend, reason, actionNote };
}

// ─── Market Rules ────────────────────────────────────────────────────────────

const MARKET_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26",
  "2026-11-27", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-04-02",
  "2027-05-31", "2027-07-05", "2027-09-06", "2027-11-25",
  "2027-12-24",
]);

function getNextTradingDays(n: number): string[] {
  const days: string[] = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !MARKET_HOLIDAYS.has(iso)) {
      days.push(iso);
    }
  }
  return days;
}

function buildMarketRules(
  spyStreak: ReturnType<typeof calcStreak>,
  spyBars:   OHLCVBar[],
  vixPrice:  number | null
): MarketRule[] {
  const rules: MarketRule[] = [];

  // ── Rule 1: 5-Day Consecutive Down Rule ──────────────────────────────────
  {
    const count   = spyStreak.direction === "down" ? spyStreak.count : 0;
    const status: MarketRule["status"] =
      count >= 5 ? "triggered" :
      count === 4 ? "approaching" :
      count === 3 ? "watch" : "inactive";

    rules.push({
      id: "five_day_rule",
      name: "5-Day Consecutive Down Rule",
      category: "Mean Reversion",
      description:
        "The S&P 500 has historically bounced within 1–2 sessions after closing down 5 consecutive days. " +
        "This is one of the most reliable short-term mean-reversion setups in equities. " +
        "Oscar Carboni: 'The market never goes in one direction forever — especially not 5 days in a row without a fight.'",
      status,
      currentValue: `SPY: ${count} consecutive down day${count !== 1 ? "s" : ""}`,
      threshold: "5 consecutive down days",
      historicalEdge: "~90% reversal rate within 2 sessions after 5th down day",
      actionNote:
        count >= 5
          ? "RULE ACTIVE: Mean reversion setup. Watch for reversal candle / buy signal. Risk: gap down continuation on extreme fear."
          : count === 4
          ? "One more down day triggers the 5-day rule. Prepare mean-reversion long setup."
          : count === 3
          ? "3 consecutive down days — 5-day setup building. Track closely."
          : "Not active — S&P has not had an extended consecutive losing streak.",
      source: "Statistical / Oscar Carboni",
    });
  }

  // ── Rule 2: New Highs Beget New Highs ────────────────────────────────────
  {
    const closes      = spyBars.map(b => b.close);
    const current     = closes[closes.length - 1];
    const high52w     = Math.max(...closes.slice(-252));
    const pctFromHigh = ((current - high52w) / high52w) * 100;
    const isNearHigh  = pctFromHigh >= -2;

    rules.push({
      id: "new_highs_beget_new_highs",
      name: "New Highs Beget New Highs",
      category: "Momentum",
      description:
        "When an index is making or approaching 52-week highs, the path of least resistance is up. " +
        "New all-time highs eliminate overhead supply — no trapped longs. " +
        "Oscar Carboni's principle: 'New highs beget new highs.' Forward 20-day returns after new 52-week highs are historically 2× average.",
      status: isNearHigh ? "triggered" : pctFromHigh >= -5 ? "watch" : "inactive",
      currentValue: `SPY ${pctFromHigh.toFixed(1)}% from 52-week high`,
      threshold: "Within 2% of 52-week high",
      historicalEdge: "Avg 20-day forward return 2× higher when near 52-week highs vs random",
      actionNote: isNearHigh
        ? "RULE ACTIVE: Momentum confirmed. Trend continuation bias — hold longs, add on dips."
        : pctFromHigh >= -5
        ? "Approaching 52-week high zone. Breakout above = strong continuation signal."
        : `SPY ${Math.abs(pctFromHigh).toFixed(1)}% below 52-week high — rule inactive.`,
      source: "Oscar Carboni / Momentum Research",
    });
  }

  // ── Rule 3: Pre-Holiday Drift ─────────────────────────────────────────────
  {
    const nextDays      = getNextTradingDays(5);
    const holidayInNext = nextDays.find(d => MARKET_HOLIDAYS.has(d));

    const HOLIDAY_NAMES: Record<string, string> = {
      "2026-05-25": "Memorial Day", "2026-07-03": "Independence Day",
      "2026-09-07": "Labor Day",    "2026-11-26": "Thanksgiving",
      "2026-12-25": "Christmas",    "2026-01-01": "New Year's Day",
    };

    const holidayName = holidayInNext ? (HOLIDAY_NAMES[holidayInNext] ?? "Market Holiday") : null;
    const daysUntil   = holidayInNext ? nextDays.indexOf(holidayInNext) + 1 : null;

    rules.push({
      id: "pre_holiday_drift",
      name: "Pre-Holiday Drift",
      category: "Seasonal",
      description:
        "Markets tend to drift upward in the 1–3 trading days before major U.S. market holidays " +
        "(Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas). " +
        "Historically the 2 days before a long weekend show positive bias, attributed to " +
        "short-covering, reduced institutional selling, and retail optimism.",
      status: daysUntil !== null && daysUntil <= 3 ? "triggered" : daysUntil !== null && daysUntil <= 5 ? "watch" : "inactive",
      currentValue: holidayName ? `${holidayName} in ${daysUntil} trading day${daysUntil !== 1 ? "s" : ""}` : "No holiday within 5 trading days",
      threshold: "Within 3 trading days of major holiday",
      historicalEdge: "Pre-holiday sessions positive ~68% of time; avg +0.3% vs +0.04% average",
      actionNote: daysUntil !== null && daysUntil <= 3
        ? `PRE-HOLIDAY DRIFT: ${holidayName} in ${daysUntil} day(s). Slight upward bias — reduce short exposure, hold longs.`
        : daysUntil !== null
        ? `${holidayName} approaching in ${daysUntil} days. Monitor for drift to develop.`
        : "No imminent holiday. Rule inactive.",
      source: "Seasonal / Statistical",
    });
  }

  // ── Rule 4: VIX Mean Reversion ────────────────────────────────────────────
  if (vixPrice !== null) {
    const vixLevel = vixPrice;
    const isSpike   = vixLevel >= 25;
    const isExtreme = vixLevel >= 35;
    const isCalmZone = vixLevel < 15;

    rules.push({
      id: "vix_mean_reversion",
      name: "VIX Fear Spike Reversion",
      category: "Volatility",
      description:
        "The VIX (fear index) is highly mean-reverting. When VIX spikes above 25 (fear) or 35 (panic), " +
        "equity markets historically bottom and recover within 5–15 sessions as volatility normalizes. " +
        "Conversely, a VIX below 12–13 signals complacency — watch for sharp reversals.",
      status: isExtreme ? "triggered" : isSpike ? "approaching" : isCalmZone ? "watch" : "inactive",
      currentValue: `VIX ${vixLevel.toFixed(1)}`,
      threshold: "VIX ≥ 25 (fear), ≥ 35 (panic), < 13 (complacency)",
      historicalEdge: "When VIX >25, S&P positive next 10 sessions ~72% of time. VIX >35: ~82%.",
      actionNote: isExtreme
        ? `VIX PANIC ZONE (${vixLevel.toFixed(1)}): Capitulation likely near or here. Historical equity rally within 5–10 sessions. High-conviction mean-reversion long setup.`
        : isSpike
        ? `VIX FEAR SPIKE (${vixLevel.toFixed(1)}): Elevated fear. Equity weakness may be near exhaustion. Watch for vol crush / reversal.`
        : isCalmZone
        ? `VIX COMPLACENCY (${vixLevel.toFixed(1)}): Historically signals elevated risk of sharp reversal. Tighten stops, reduce leverage.`
        : `VIX ${vixLevel.toFixed(1)} — normal range. No volatility regime extreme detected.`,
      source: "Volatility Research / Statistical",
    });
  }

  // ── Rule 5: Dow Theory — Transport Confirmation ───────────────────────────
  {
    rules.push({
      id: "dow_theory_transport",
      name: "Dow Theory: Transport Confirmation",
      category: "Intermarket",
      description:
        "Classic Dow Theory: a sustained bull market requires both the Industrial Average (DIA) AND " +
        "the Transportation Average (IYT) to make new highs together. When Transports lag or diverge " +
        "from Industrials, the primary trend may be weakening — a warning signal used by institutional desks.",
      status: "watch",
      currentValue: "Compare DIA vs IYT 20-day trend",
      threshold: "Both making new highs (confirmation) or diverging (warning)",
      historicalEdge: "Non-confirmation signals (Transports lagging) precede corrections 60%+ of time",
      actionNote: "Monitor DIA and IYT together. If DIA rallies but IYT does not confirm, treat rally with caution.",
      source: "Dow Theory / Charles Dow",
    });
  }

  // ── Rule 6: Three-Pushes Exhaustion ──────────────────────────────────────
  {
    const closes    = spyBars.map(b => b.close);
    const last20    = closes.slice(-20);
    const last20Hi  = Math.max(...last20);
    const last20Lo  = Math.min(...last20);
    const range     = last20Hi - last20Lo;
    const current   = closes[closes.length - 1];
    const nearTop   = (last20Hi - current) / range < 0.10;
    const nearBot   = (current - last20Lo) / range < 0.10;

    rules.push({
      id: "three_pushes_exhaustion",
      name: "Three Pushes to a High/Low",
      category: "Pattern",
      description:
        "Oscar Carboni's 'Three Pushes' pattern: when a market makes three successive pushes toward a high " +
        "(or low) with diminishing momentum, the move is typically exhausted. The third push often fails " +
        "to hold and reverses sharply. Watch for three drives to resistance/support on the chart.",
      status: nearTop || nearBot ? "watch" : "inactive",
      currentValue: nearTop
        ? `SPY near 20-day high — watch for 3rd push exhaustion`
        : nearBot
        ? `SPY near 20-day low — watch for capitulation / 3-push reversal`
        : `SPY mid-range (20-day)`,
      threshold: "Price at 20-day extreme (top or bottom 10% of range)",
      historicalEdge: "Third push to resistance/support with RSI divergence fails and reverses ~65% of time",
      actionNote: nearTop
        ? "Price near recent highs. If this is a 3rd push with weakening momentum/RSI divergence → reduce longs."
        : nearBot
        ? "Price near recent lows. If this is a 3rd push with RSI divergence → watch for reversal / long setup."
        : "No extreme position. Rule inactive.",
      source: "Oscar Carboni",
    });
  }

  return rules;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export async function runMarketTendencies(): Promise<MarketTendenciesResult> {
  const CACHE_KEY = "market_tendencies";
  const cached = tendencyCache.get<MarketTendenciesResult>(CACHE_KEY);
  if (cached) return cached;

  logger.info("Market tendencies: running analysis");

  // Fetch ~2 years of daily bars for each index + VIX
  const [spyBars, qqqBars, iwmBars, diaBars, vixBars] = await Promise.all([
    fetchOHLCV("SPY",  "2y", "1d"),
    fetchOHLCV("QQQ",  "2y", "1d"),
    fetchOHLCV("IWM",  "2y", "1d"),
    fetchOHLCV("DIA",  "2y", "1d"),
    fetchOHLCV("^VIX", "5d", "1d").catch(() => [] as OHLCVBar[]),
  ]);

  const allBars: Record<string, OHLCVBar[]> = {
    SPY: spyBars, QQQ: qqqBars, IWM: iwmBars, DIA: diaBars,
  };

  const vixPrice = vixBars.length > 0 ? vixBars[vixBars.length - 1].close : null;

  // ── Build index tendency objects ──────────────────────────────────────────
  const indices: IndexTendency[] = INDICES.map(({ ticker, name }) => {
    const bars  = allBars[ticker];
    if (!bars || bars.length < 10) {
      return {
        ticker, name,
        currentPrice: 0, dayChangePct: 0,
        streak:          { direction: "flat", count: 0, label: "No data", alert: null },
        priceVsSma50Pct: 0, priceVsSma200Pct: 0, rsi14: 50,
        recentCloses:    [],
        omni:            { signal: "YELLOW", strength: "weak", weeklyTrend: "neutral", reason: "Insufficient data", actionNote: "—" },
      };
    }

    const closes          = bars.map(b => b.close);
    const current         = closes[closes.length - 1];
    const prev            = closes[closes.length - 2] ?? current;
    const dayChangePct    = Math.round(((current - prev) / prev) * 10000) / 100;

    const sma50           = sma(closes, 50);
    const sma200          = sma(closes, 200);
    const priceVsSma50Pct  = Math.round(((current - sma50)  / sma50)  * 10000) / 100;
    const priceVsSma200Pct = Math.round(((current - sma200) / sma200) * 10000) / 100;
    const rsi14            = calcRSI14(closes);

    const streakRaw  = calcStreak(bars);
    const streak: StreakInfo = {
      ...streakRaw,
      label: streakLabel(streakRaw),
      alert: streakAlert(streakRaw),
    };

    const omni = calcOmni(bars, streakRaw, priceVsSma50Pct, priceVsSma200Pct, rsi14);

    return {
      ticker, name,
      currentPrice:    Math.round(current * 100) / 100,
      dayChangePct,
      streak,
      priceVsSma50Pct,
      priceVsSma200Pct,
      rsi14,
      recentCloses:    closes.slice(-15).map(c => Math.round(c * 100) / 100),
      omni,
    };
  });

  // ── SPY streak stats (used for the table + rule evaluation) ──────────────
  const spyStreakStats = {
    ticker: "SPY",
    down: calcStreakStats(spyBars, "down", 6),
    up:   calcStreakStats(spyBars, "up",   6),
  };

  // ── Market rules ──────────────────────────────────────────────────────────
  const spyTendency = indices.find(i => i.ticker === "SPY");
  const spyStreakRaw = spyTendency
    ? { direction: spyTendency.streak.direction, count: spyTendency.streak.count }
    : { direction: "flat" as const, count: 0 };

  const marketRules = buildMarketRules(spyStreakRaw as ReturnType<typeof calcStreak>, spyBars, vixPrice);

  const result: MarketTendenciesResult = {
    indices,
    streakStats: spyStreakStats,
    marketRules,
    analyzedAt: new Date().toISOString(),
  };

  tendencyCache.set(CACHE_KEY, result);
  return result;
}
