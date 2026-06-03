import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  useGetStockAnalysis, 
  getGetStockAnalysisQueryKey,
  OHLCVBar,
} from "@workspace/api-client-react";
import WatchlistSidebar from "@/components/layout/WatchlistSidebar";
import LightweightChart, { ChartPriceLine, ChartLineSeries, ChartSignalMarker, ExtendedHoursPoint, PatternOverlay, ScoreOverlayPoint } from "@/components/charts/LightweightChart";
import ScoreGauge from "@/components/charts/ScoreGauge";
import MiniGauge from "@/components/charts/MiniGauge";
import RsiMiniChart from "@/components/charts/RsiMiniChart";
import { formatCurrency, formatPercent, formatNumber, getColorForScore, getColorForDirection } from "@/lib/formatters";
import { Search, Info, TrendingUp, TrendingDown, Minus, Clock, X, ChevronDown, ChevronRight, FlaskConical, RotateCcw, GitBranch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BacktestPoint  { x: number; y: number; date: string; }
interface BacktestBucket { count: number; hitRate: number | null; avgReturn: number | null; }
interface BacktestDecile { bucket: string; count: number; hitRate: number | null; avgReturn: number | null; }
interface BacktestCatIC  { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number; }
interface BacktestWeights { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number; }
interface BacktestResult {
  ticker: string; horizon: number;
  marketCap: number | null; marketCapBucket: string; marketCapNote: string;
  ic: number; icRating: string;
  rankIC: number; rankICRating: string; icTStat: number;
  totalObservations: number;
  calibratedSlope: number; calibratedIntercept: number;
  categoryIC: BacktestCatIC;
  optimalWeights: BacktestWeights | null;
  currentWeights: BacktestWeights;
  bull: BacktestBucket; neutral: BacktestBucket; bear: BacktestBucket;
  deciles: BacktestDecile[];
  scatter: BacktestPoint[];
}

// gapPct: open vs prior close (%). If session already gapped ≥1.5%, elevated
// ATR/BB/RVOL are post-gap aftermath, not a forward signal → score 0.
function calcGapProbScore(atrPct: number, bbWidth: number, relVol: number, gapPct = 0): number {
  if (Math.abs(gapPct) >= 1.5) return 0;
  const c = (v: number) => Math.max(0, Math.min(100, v));
  const atrS  = c((atrPct  - 3.2)  / (4.8  - 3.2)  * 100);
  const bbS   = c((bbWidth - 15)   / (23.7 - 15)   * 100);
  const rvolS = c((relVol  - 1.2)  / (1.45 - 1.2)  * 100);
  return Math.round(0.40 * atrS + 0.35 * bbS + 0.25 * rvolS);
}

function ScatterPlot({ data, width = 240, height = 110 }: { data: BacktestPoint[]; width?: number; height?: number }) {
  if (!data.length) return null;
  const pad = { t: 8, r: 8, b: 24, l: 28 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const xs = data.map(d => d.x);
  const ys = data.map(d => d.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const toSvgX = (v: number) => pad.l + ((v - xMin) / xRange) * W;
  const toSvgY = (v: number) => pad.t + H - ((v - yMin) / yRange) * H;
  const zero = toSvgY(0);

  // Least-squares regression line
  const n = data.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const x1 = xMin, y1 = slope * x1 + intercept;
  const x2 = xMax, y2 = slope * x2 + intercept;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* zero line */}
      {zero > pad.t && zero < pad.t + H && (
        <line x1={pad.l} x2={pad.l + W} y1={zero} y2={zero} stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
      )}
      {/* regression line */}
      <line
        x1={toSvgX(x1)} y1={toSvgY(y1)} x2={toSvgX(x2)} y2={toSvgY(y2)}
        stroke={slope > 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"}
        strokeWidth={1.5}
      />
      {/* dots */}
      {data.map((d, i) => (
        <circle
          key={i} cx={toSvgX(d.x)} cy={toSvgY(d.y)} r={2}
          fill={d.y > 0 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}
        />
      ))}
      {/* axes labels */}
      <text x={pad.l} y={height - 4} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace">Score</text>
      <text x={pad.l + W} y={height - 4} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace" textAnchor="end">{xMax.toFixed(0)}</text>
      <text x={pad.l - 2} y={pad.t + 6} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace" textAnchor="end">Ret%</text>
    </svg>
  );
}

function icColor(rating: string): string {
  return rating === "strong" ? "text-success" : rating === "moderate" ? "text-warning" : "text-muted-foreground";
}

// ── Quick Backtest Strip (shown inline in the chart section) ─────────────────

/** Mini sparkline of Atlas Score over the last ~60 trading days. */
function ScoreSparkline({ ticker }: { ticker: string }) {
  const [pts, setPts] = useState<number[]>([]);
  useEffect(() => {
    if (!ticker) return;
    let cancelled = false;
    fetch(`/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=5`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (cancelled || !d?.timeline) return;
        setPts((d.timeline as Array<{ score: number }>).slice(-60).map((p: { score: number }) => p.score));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker]);

  if (pts.length < 5) return <div className="h-9 mt-2 mx-6 rounded bg-muted/10 animate-pulse" />;

  const W = 180, H = 34, pad = 3;
  const toY = (s: number) => pad + (1 - s / 100) * (H - pad * 2);
  const xStep = (W - pad * 2) / (pts.length - 1);
  const polyPoints = pts.map((s, i) => `${pad + i * xStep},${toY(s)}`).join(" ");
  const last = pts[pts.length - 1];
  const lx = pad + (pts.length - 1) * xStep;
  const lineColor = last >= 65 ? "#22c55e" : last >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <div className="px-6 mt-2 flex flex-col items-center gap-0.5">
      <div className="text-[9px] font-mono tracking-widest text-muted-foreground/40">SCORE HISTORY · 60D</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        {[30, 50, 70].map(ref => (
          <line key={ref} x1={pad} x2={W - pad} y1={toY(ref)} y2={toY(ref)}
            stroke="hsl(222,15%,20%)" strokeWidth="0.5" strokeDasharray="2,3" />
        ))}
        <polyline points={polyPoints} fill="none" stroke={lineColor}
          strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
        <circle cx={lx} cy={toY(last)} r="2.5" fill={lineColor} />
      </svg>
    </div>
  );
}

function ChartBacktestStrip({ ticker, currentScore }: { ticker: string; currentScore?: number }) {
  const [, navigate] = useLocation();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Clear results when ticker changes so stale data isn't shown
  useEffect(() => { setResult(null); }, [ticker]);

  const run = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const r = await fetch(`/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=10`, { signal: ctrl.signal });
      if (!r.ok) throw new Error("failed");
      setResult(await r.json());
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") { /* silent — strip stays in idle */ }
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  const calibratedProb = (result && currentScore !== undefined)
    ? Math.round((1 / (1 + Math.exp(-(result.calibratedSlope * currentScore + result.calibratedIntercept)))) * 100)
    : null;

  const contrarian  = result && result.rankIC < 0;
  const signalValid = result && Math.abs(result.icTStat) >= 1.65;

  return (
    <div className="px-3 py-1.5 border-b border-border bg-zinc-950/60 flex items-center gap-3 text-xs font-mono min-h-[30px]">
      {!result && !loading && (
        <button
          onClick={run}
          className="flex items-center gap-1.5 text-primary/80 hover:text-primary border border-primary/25 rounded px-2 py-0.5 hover:bg-primary/10 transition-colors"
        >
          <FlaskConical className="w-3 h-3" /> RUN BACKTEST (10D)
        </button>
      )}

      {loading && (
        <span className="text-muted-foreground animate-pulse">
          COMPUTING 10D BACKTEST… ~15–20s
        </span>
      )}

      {result && !loading && (
        <>
          {/* Rank IC */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground/55">RANK IC</span>
            <span className={cn("font-bold", icColor(result.rankICRating))}>
              {result.rankIC >= 0 ? "+" : ""}{result.rankIC.toFixed(3)}
            </span>
            <span className="text-muted-foreground/40 text-[10px]">{result.rankICRating}</span>
          </div>

          <span className="text-border/60">|</span>

          {/* t-statistic */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground/55">t</span>
            <span className={cn("font-bold",
              Math.abs(result.icTStat) >= 2    ? "text-success" :
              Math.abs(result.icTStat) >= 1.65 ? "text-warning"  : "text-muted-foreground"
            )}>
              {result.icTStat.toFixed(2)}
            </span>
          </div>

          <span className="text-border/60">|</span>

          {/* Observations */}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground/55">OBS</span>
            <span className="text-foreground/80">{result.totalObservations}</span>
          </div>

          <span className="text-border/60">|</span>

          {/* Signal mode badge */}
          <span className={cn(
            "px-1.5 py-px rounded text-[10px] font-bold tracking-wider border",
            contrarian  ? "bg-amber-500/12 text-amber-400 border-amber-500/25" :
            signalValid ? "bg-emerald-500/12 text-emerald-400 border-emerald-500/25" :
                          "bg-zinc-700/30 text-muted-foreground border-border"
          )}>
            {contrarian ? "CONTRARIAN" : signalValid ? "MOMENTUM" : "NOISE"}
          </span>

          {/* Calibrated probability for current score */}
          {calibratedProb !== null && (
            <>
              <span className="text-border/60">|</span>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground/55">P(+)</span>
                <span className={cn("font-bold",
                  calibratedProb >= 60 ? "text-success" :
                  calibratedProb >= 45 ? "text-muted-foreground" : "text-destructive"
                )}>
                  {calibratedProb}%
                </span>
              </div>
            </>
          )}

          {/* Bull hit rate */}
          {result.bull.hitRate !== null && (
            <>
              <span className="text-border/60">|</span>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground/55">BULL HIT</span>
                <span className={cn("font-bold",
                  result.bull.hitRate >= 65 ? "text-success" :
                  result.bull.hitRate >= 55 ? "text-warning"  : "text-muted-foreground"
                )}>
                  {result.bull.hitRate}%
                </span>
                <span className="text-muted-foreground/40">avg {result.bull.avgReturn !== null ? (result.bull.avgReturn >= 0 ? "+" : "") + result.bull.avgReturn.toFixed(1) + "%" : "—"}</span>
              </div>
            </>
          )}

          <div className="flex-1" />

          {/* Re-run */}
          <button
            onClick={run}
            title="Re-run backtest"
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          {/* Full lab link */}
          <button
            onClick={() => navigate(`/backtest?ticker=${ticker}`)}
            className="text-primary/65 hover:text-primary transition-colors border border-primary/20 rounded px-2 py-0.5 hover:bg-primary/10"
          >
            FULL LAB ↗
          </button>
        </>
      )}
    </div>
  );
}

function BacktestPanel({ ticker, currentScore }: { ticker: string; currentScore?: number }) {
  const [open, setOpen] = useState(false);
  const [horizon, setHorizon] = useState(10);
  const [data, setData] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (h: number) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true); setError(null); setData(null);
    try {
      const r = await fetch(`/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=${h}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { if (open) run(horizon); }, [open, ticker]);

  // Calibrated vs heuristic probability for current score
  const calibratedProb = (data && currentScore !== undefined)
    ? Math.round((1 / (1 + Math.exp(-(data.calibratedSlope * currentScore + data.calibratedIntercept)))) * 100)
    : null;
  const heuristicProb  = currentScore !== undefined
    ? Math.round((1 / (1 + Math.exp(-0.08 * (currentScore - 50)))) * 100)
    : null;

  const CAP_LABELS: Record<string, string> = {
    mega: "MEGA", large: "LARGE", mid: "MID", small: "SMALL", unknown: "?",
  };

  const FACTOR_LABELS: Array<[keyof BacktestCatIC, string]> = [
    ["trend", "TREND"], ["momentum", "MOMENTUM"], ["volume", "VOLUME"],
    ["relativeStrength", "REL STR"], ["regime", "REGIME"],
  ];

  const WEIGHT_LABELS: Array<[keyof BacktestWeights, string]> = [
    ["trend", "TREND"], ["momentum", "MOMENTUM"], ["volume", "VOLUME"],
    ["relativeStrength", "REL STR"], ["regime", "REGIME"],
  ];

  return (
    <div className="border-t border-border mt-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-3 text-xs font-bold tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2"><FlaskConical className="w-3 h-3" /> WALK-FORWARD BACKTEST</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open && (
        <div className="space-y-4 pb-4">
          {/* Horizon selector */}
          <div className="flex items-center gap-1">
            {[5, 10, 20].map(h => (
              <button key={h} onClick={() => { setHorizon(h); run(h); }}
                className={cn("px-2 py-0.5 text-xs font-mono border rounded transition-colors",
                  horizon === h ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-foreground"
                )}>{h}D</button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground font-mono">fwd horizon</span>
          </div>

          {loading && <div className="text-xs text-muted-foreground font-mono animate-pulse py-4 text-center">COMPUTING ~10–20s…</div>}
          {error   && <div className="text-xs text-destructive font-mono">{error}</div>}

          {data && !loading && (
            <div className="space-y-4">

              {/* ── IC Summary ─────────────────────────────────── */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">IC METRICS</div>
                {[
                  { label: "RANK IC (Spearman)", val: data.rankIC, rating: data.rankICRating },
                  { label: "PEARSON IC", val: data.ic, rating: data.icRating },
                ].map(({ label, val, rating }) => (
                  <div key={label} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={cn("font-bold", icColor(rating))}>
                      {val > 0 ? "+" : ""}{val.toFixed(3)}
                      <span className="font-normal text-muted-foreground/70 ml-1">({rating})</span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-muted-foreground">T-STAT (n={data.totalObservations})</span>
                  <span className={cn("font-bold",
                    Math.abs(data.icTStat) >= 2 ? "text-success" : Math.abs(data.icTStat) >= 1.5 ? "text-warning" : "text-muted-foreground"
                  )}>{data.icTStat > 0 ? "+" : ""}{data.icTStat.toFixed(2)}
                    <span className="font-normal text-muted-foreground/70 ml-1">
                      {Math.abs(data.icTStat) >= 2 ? "(sig)" : "(insig)"}
                    </span>
                  </span>
                </div>
              </div>

              {/* ── Market Cap Note ─────────────────────────────── */}
              <div className="bg-card border border-border/60 rounded p-2.5 space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono font-bold">
                  <span className="px-1.5 py-0.5 bg-primary/15 text-primary rounded text-[10px]">
                    {CAP_LABELS[data.marketCapBucket] ?? data.marketCapBucket.toUpperCase()}-CAP
                  </span>
                  {data.marketCap && (
                    <span className="text-muted-foreground/60 font-normal">
                      ${(data.marketCap / 1e9).toFixed(1)}B
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{data.marketCapNote}</p>
              </div>

              {/* ── Calibration ─────────────────────────────────── */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">LOGISTIC CALIBRATION</div>
                <div className="flex gap-4 text-xs font-mono text-muted-foreground">
                  <span>slope <span className="text-foreground">{data.calibratedSlope.toFixed(3)}</span></span>
                  <span>intercept <span className="text-foreground">{data.calibratedIntercept.toFixed(2)}</span></span>
                </div>
                {calibratedProb !== null && heuristicProb !== null && (
                  <div className="flex items-center justify-between text-xs font-mono bg-border/20 rounded p-2">
                    <span className="text-muted-foreground">SCORE {currentScore} HIT RATE</span>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">{calibratedProb}% fitted</span>
                      <span className="text-muted-foreground/50">vs {heuristicProb}% heuristic</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Bucket hit rates ─────────────────────────────── */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">BUCKET HIT RATES</div>
                {[
                  { label: "BULL (≥60)", b: data.bull,    positive: true,  color: "text-success" },
                  { label: "NEUTRAL",    b: data.neutral, positive: true,  color: "text-muted-foreground" },
                  { label: "BEAR (≤40)", b: data.bear,    positive: false, color: "text-destructive" },
                ].map(({ label, b, positive, color }) => (
                  <div key={label} className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                    <div className="flex-1 bg-border/30 rounded-full h-1.5 overflow-hidden">
                      <div className={cn("h-full rounded-full", positive ? "bg-success/60" : "bg-destructive/60")}
                        style={{ width: `${b.hitRate ?? 0}%` }} />
                    </div>
                    <span className={cn("w-8 text-right", color)}>{b.hitRate ?? "—"}%</span>
                    <span className="text-muted-foreground/60 w-12 text-right">
                      {b.avgReturn !== null ? `${b.avgReturn > 0 ? "+" : ""}${b.avgReturn}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Scatter ──────────────────────────────────────── */}
              <div>
                <div className="text-xs text-muted-foreground font-mono mb-1 font-bold tracking-wider">SCORE vs {data.horizon}D RETURN</div>
                <ScatterPlot data={data.scatter} width={236} height={100} />
              </div>

              {/* ── Decile table ─────────────────────────────────── */}
              <div className="space-y-1">
                <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">DECILE TABLE (monotonicity check)</div>
                <div className="grid text-[10px] font-mono gap-y-0.5">
                  <div className="grid grid-cols-4 text-muted-foreground/50 border-b border-border/40 pb-0.5">
                    <span>SCORE</span><span className="text-right">N</span>
                    <span className="text-right">HIT%</span><span className="text-right">AVG RET</span>
                  </div>
                  {data.deciles.map(d => (
                    <div key={d.bucket} className={cn(
                      "grid grid-cols-4",
                      d.hitRate !== null && d.hitRate >= 55 ? "text-success/80" :
                      d.hitRate !== null && d.hitRate <= 45 ? "text-destructive/70" : "text-muted-foreground/70"
                    )}>
                      <span>{d.bucket}</span>
                      <span className="text-right">{d.count}</span>
                      <span className="text-right">{d.hitRate !== null ? `${d.hitRate}%` : "—"}</span>
                      <span className="text-right">{d.avgReturn !== null ? `${d.avgReturn > 0 ? "+" : ""}${d.avgReturn}%` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Category IC ──────────────────────────────────── */}
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">FACTOR IC (SPEARMAN)</div>
                {FACTOR_LABELS.map(([key, label]) => {
                  const v = data.categoryIC[key];
                  const w = Math.min(Math.abs(v) / 0.15 * 100, 100);
                  return (
                    <div key={key} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                      <div className="flex-1 bg-border/30 rounded-full h-1.5 overflow-hidden">
                        <div className={cn("h-full rounded-full", v >= 0 ? "bg-success/60" : "bg-destructive/50")}
                          style={{ width: `${w}%` }} />
                      </div>
                      <span className={cn("w-14 text-right font-bold", icColor(Math.abs(v) >= 0.10 ? "strong" : Math.abs(v) >= 0.05 ? "moderate" : "noise"))}>
                        {v > 0 ? "+" : ""}{v.toFixed(3)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── IC²-Optimal vs Current Weights ───────────────── */}
              {data.optimalWeights && (
                <div className="space-y-1.5">
                  <div className="text-xs font-bold text-muted-foreground/60 tracking-wider">IC²-OPTIMAL vs CURRENT WEIGHTS</div>
                  <div className="grid text-[10px] font-mono gap-y-0.5">
                    <div className="grid grid-cols-4 text-muted-foreground/50 border-b border-border/40 pb-0.5">
                      <span className="col-span-2">FACTOR</span>
                      <span className="text-right">CUR</span><span className="text-right">OPT</span>
                    </div>
                    {WEIGHT_LABELS.map(([key, label]) => {
                      const cur = data.currentWeights[key];
                      const opt = data.optimalWeights![key];
                      const diff = opt - cur;
                      return (
                        <div key={key} className="grid grid-cols-4">
                          <span className="col-span-2 text-muted-foreground/70">{label}</span>
                          <span className="text-right text-muted-foreground/70">{cur}%</span>
                          <span className={cn("text-right font-bold",
                            diff > 5 ? "text-success" : diff < -5 ? "text-destructive" : "text-muted-foreground"
                          )}>{opt}% {diff > 5 ? "▲" : diff < -5 ? "▼" : "="}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground/40 font-mono leading-relaxed pt-1">
                Walk-forward: scored daily using only prior data. IC {'>'} 0.05 = signal. |t| {'>'} 2 = statistically significant.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Retracement Forecast Panel ────────────────────────────────────────────────

interface RetracementTarget {
  level: 50 | 75 | 100;
  price: number;
  hitRate: number | null;
  medianBars: number | null;
  expectedDate: string | null;
  comparableN: number;
}

interface RetracementForecast {
  ticker: string;
  interval: string;
  currentMove: {
    direction: "up" | "down";
    pivotDate: string;
    pivotPrice: number;
    currentPrice: number;
    movePct: number;
    moveBars: number;
  };
  targets: RetracementTarget[];
  comparableMovesN: number;
  analyzedBars: number;
  note: string | null;
  cachedAt: string;
}

const RETRACE_INTERVALS = ["1h", "1d", "1wk"] as const;
type RetraceInterval = (typeof RETRACE_INTERVALS)[number];

function RetracementPanel({ ticker }: { ticker: string }) {
  const [open, setOpen]       = useState(false);
  const [interval, setInterval] = useState<RetraceInterval>("1d");
  const [data, setData]       = useState<RetracementForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (iv: RetraceInterval) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true); setError(null); setData(null);
    try {
      const r = await fetch(
        `/api/stock/${encodeURIComponent(ticker)}/retracement?interval=${iv}`,
        { signal: ctrl.signal },
      );
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`); }
      setData(await r.json());
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  // Reset when ticker changes so stale data doesn't linger
  useEffect(() => { setData(null); setError(null); }, [ticker]);
  useEffect(() => { if (open) load(interval); }, [open, ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = data?.currentMove;

  return (
    <div className="border-t border-border mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between py-3 text-xs font-bold tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-2">
          <GitBranch className="w-3 h-3" />
          RETRACEMENT FORECAST
        </span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open && (
        <div className="space-y-3 pb-4">
          {/* Interval selector */}
          <div className="flex items-center gap-1">
            {RETRACE_INTERVALS.map(iv => (
              <button key={iv} onClick={() => { setInterval(iv); load(iv); }}
                className={cn("px-2 py-0.5 text-xs font-mono border rounded transition-colors",
                  interval === iv
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-foreground"
                )}
              >{iv.toUpperCase()}</button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground font-mono">bar size</span>
          </div>

          {loading && (
            <div className="text-xs text-muted-foreground font-mono animate-pulse py-4 text-center">
              SCANNING {data ? 0 : "5Y"} OF HISTORY…
            </div>
          )}
          {error && <div className="text-xs text-destructive font-mono">{error}</div>}

          {data && !loading && (
            <div className="space-y-3">
              {/* ── Current move summary ─────────────────── */}
              {m && (
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded font-bold text-[9px]",
                    m.direction === "up"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400",
                  )}>
                    {m.direction === "up" ? "▲" : "▼"} {m.direction.toUpperCase()}
                  </span>
                  <span className={m.direction === "up" ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>
                    +{m.movePct.toFixed(2)}%
                  </span>
                  <span className="text-muted-foreground">
                    from {formatCurrency(m.pivotPrice)} · {m.moveBars}d ago
                  </span>
                </div>
              )}

              {data.note && (
                <div className="text-[10px] text-warning/80 font-mono leading-relaxed border border-warning/20 rounded px-2 py-1.5 bg-warning/5">
                  {data.note}
                </div>
              )}

              {/* ── Retrace target rows ──────────────────── */}
              <div className="space-y-2">
                {data.targets.map(tgt => {
                  const barColor =
                    tgt.level === 50  ? "bg-amber-500/70" :
                    tgt.level === 75  ? "bg-orange-500/70" :
                                        "bg-red-500/70";
                  const hitPct = tgt.hitRate ?? 0;
                  return (
                    <div key={tgt.level} className="space-y-0.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground w-8">{tgt.level}%</span>
                        <span className="font-bold text-foreground">{formatCurrency(tgt.price)}</span>
                        <span className={cn("font-bold",
                          hitPct >= 70 ? "text-emerald-400" :
                          hitPct >= 50 ? "text-amber-400" : "text-muted-foreground"
                        )}>
                          {tgt.hitRate !== null ? `${tgt.hitRate}%` : "—"}
                        </span>
                        <span className="text-muted-foreground/60 text-[10px]">
                          {tgt.medianBars !== null
                            ? `~${tgt.medianBars}${interval === "1h" ? "h" : interval === "1wk" ? "wk" : "d"}`
                            : "—"}
                        </span>
                        {tgt.expectedDate && (
                          <span className="text-muted-foreground/50 text-[10px]">{tgt.expectedDate.slice(5)}</span>
                        )}
                      </div>
                      {/* Hit-rate bar */}
                      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", barColor)}
                          style={{ width: `${hitPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-[10px] text-muted-foreground/40 font-mono leading-relaxed pt-1">
                {data.comparableMovesN >= 5
                  ? `Based on ${data.comparableMovesN} comparable ${m?.direction} moves · hit rate = % that retraced to target within 50 bars`
                  : `Only ${data.comparableMovesN} comparable moves found — rates may be unreliable`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AnalysisForPriceLines {
  volatility: { bollingerUpper: number; bollingerLower: number };
  patterns: { supportLevel: number | null; resistanceLevel: number | null };
  fibLevels?: { trend: string; levels: { ratio: number; price: number; label: string }[] } | null;
  volumeProfile?: { poc: number; vah: number; val: number } | null;
}

function buildPriceLines(data: AnalysisForPriceLines): ChartPriceLine[] {
  const lines: ChartPriceLine[] = [
    { price: data.volatility.bollingerUpper, label: "BB+", color: "rgba(156,163,175,0.45)", lineStyle: "dotted" },
    { price: data.volatility.bollingerLower, label: "BB-", color: "rgba(156,163,175,0.45)", lineStyle: "dotted" },
  ];
  if (data.patterns.supportLevel)    lines.push({ price: data.patterns.supportLevel,    label: "SUP", color: "rgba(34,197,94,0.6)",  lineStyle: "dashed" });
  if (data.patterns.resistanceLevel) lines.push({ price: data.patterns.resistanceLevel, label: "RES", color: "rgba(239,68,68,0.6)",  lineStyle: "dashed" });

  // ── Fibonacci retracement levels ──────────────────────────────────────────
  if (data.fibLevels?.levels) {
    const isBull = data.fibLevels.trend === "up";
    for (const fib of data.fibLevels.levels) {
      if (fib.ratio === 0 || fib.ratio === 1) {
        lines.push({ price: fib.price, label: `F${fib.label}`, color: "rgba(148,163,184,0.30)", lineStyle: "dotted" });
      } else if (fib.ratio === 0.382 || fib.ratio === 0.500 || fib.ratio === 0.618) {
        lines.push({ price: fib.price, label: `F${fib.label}`, color: isBull ? "rgba(251,191,36,0.55)" : "rgba(167,139,250,0.55)", lineStyle: "dashed" });
      } else if (fib.ratio === 0.236 || fib.ratio === 0.786) {
        lines.push({ price: fib.price, label: `F${fib.label}`, color: isBull ? "rgba(251,191,36,0.35)" : "rgba(167,139,250,0.35)", lineStyle: "dotted" });
      }
      // Skip 127.2% and 161.8% extensions — too far from price for the stub view
    }
  }

  // ── Volume Profile: POC / VAH / VAL ───────────────────────────────────────
  if (data.volumeProfile) {
    lines.push({ price: data.volumeProfile.poc, label: "POC", color: "rgba(234,179,8,0.80)",  lineStyle: "dashed" });
    lines.push({ price: data.volumeProfile.vah, label: "VAH", color: "rgba(249,115,22,0.60)", lineStyle: "dotted" });
    lines.push({ price: data.volumeProfile.val, label: "VAL", color: "rgba(249,115,22,0.60)", lineStyle: "dotted" });
  }

  return lines.filter(l => l.price > 0 && isFinite(l.price));
}

interface Timeframe {
  label: string;
  period: string;
  interval: string;
}

const TIMEFRAMES: Timeframe[] = [
  { label: "1D",  period: "1d",  interval: "1m"  },
  { label: "5D",  period: "5d",  interval: "5m"  },
  { label: "1M",  period: "1mo", interval: "60m" },
  { label: "3M",  period: "3mo", interval: "1d"  },
  { label: "6M",  period: "6mo", interval: "1d"  },
  { label: "1Y",  period: "1y",  interval: "1d"  },
  { label: "2Y",  period: "2y",  interval: "1wk" },
  { label: "5Y",  period: "5y",  interval: "1wk" },
  { label: "ALL", period: "max", interval: "1mo" },
];

const DEFAULT_TF = TIMEFRAMES[3];

function formatDateLabel(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });
}

// ── AI Narrative section ──────────────────────────────────────────────────────
function NarrativeSection({ ticker, fallback }: { ticker: string; fallback: string }) {
  const { data: narrativeData, isLoading, isError } = useQuery<{ ticker: string; narrative: string } | null>({
    queryKey: ["narrative", ticker],
    queryFn: async () => {
      const r = await fetch(`/api/stock/${encodeURIComponent(ticker)}/narrative`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!ticker,
    staleTime: 5 * 60 * 1000,
    retry: false,
    gcTime: 10 * 60 * 1000,
  });

  const narrative = narrativeData?.narrative;

  return (
    <>
      <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-2 flex items-center gap-2">
        {/* Info icon imported in parent */}
        <span className="w-3 h-3 inline-block opacity-60">ℹ</span>
        SIGNAL NARRATIVE
        {narrative && <span className="text-[9px] text-primary/60 font-mono normal-case tracking-normal ml-auto">AI</span>}
      </h3>
      {isLoading ? (
        <div className="space-y-1.5">
          <div className="h-3 bg-muted/60 rounded animate-pulse w-full" />
          <div className="h-3 bg-muted/60 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-muted/60 rounded animate-pulse w-4/6" />
        </div>
      ) : (
        <p className="text-sm text-secondary-foreground leading-relaxed">
          {(narrative && !isError) ? narrative : fallback}
        </p>
      )}
    </>
  );
}

export default function Dashboard() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const urlTicker = useMemo(
    () => new URLSearchParams(search).get("ticker") || "AAPL",
    [search]
  );

  const [ticker, setTicker] = useState(urlTicker);
  const [searchInput, setSearchInput] = useState(urlTicker);

  // Sync ticker state whenever the URL param changes (e.g. watchlist item click)
  useEffect(() => {
    setTicker(urlTicker);
    setSearchInput(urlTicker);
  }, [urlTicker]);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TF);
  const [selectedBar, setSelectedBar] = useState<{ date: string; close: number } | null>(null);
  const [showVwap, setShowVwap] = useState(false);
  const [vwapAnchor, setVwapAnchor] = useState<"3M" | "6M" | "1Y">("3M");
  const [scoreTimeline, setScoreTimeline] = useState<{ date: string; score: number }[] | null>(null);

  // Live analysis — staleTime matches server cache TTL (5 min) to avoid re-fetching fresh data
  const { data: analysis, isLoading: analysisLoading } = useGetStockAnalysis(ticker, {
    query: {
      enabled: !!ticker,
      queryKey: getGetStockAnalysisQueryKey(ticker),
      staleTime: 5 * 60 * 1000,
    }
  });

  // OHLCV — custom fetch to support period/interval params
  // staleTime=15min: server seeds shorter-period keys from the analysis 1y fetch,
  // so the first chart load is instant from cache; subsequent timeframe switches also cache.
  const { data: ohlcv, isLoading: ohlcvLoading } = useQuery<OHLCVBar[]>({
    queryKey: ["ohlcv", ticker, timeframe.period, timeframe.interval],
    queryFn: async ({ signal }) => {
      const url = `/api/stock/${encodeURIComponent(ticker)}/ohlcv?period=${timeframe.period}&interval=${timeframe.interval}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("OHLCV fetch failed");
      return res.json();
    },
    enabled: !!ticker,
    staleTime: 15 * 60 * 1000,
  });

  // Historical (point-in-time) analysis — only when a candle is clicked
  // staleTime=Infinity: point-in-time data never changes
  const { data: historicalAnalysis, isLoading: historicalLoading } = useQuery({
    queryKey: ["historical-analysis", ticker, selectedBar?.date],
    queryFn: async ({ signal }) => {
      const url = `/api/stock/${encodeURIComponent(ticker)}/historical-analysis?asOf=${selectedBar!.date}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("Historical analysis failed");
      return res.json();
    },
    enabled: !!selectedBar,
    staleTime: Infinity,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      const t = searchInput.trim().toUpperCase();
      setTicker(t);
      setSelectedBar(null);
    }
  };

  const handleCandleClick = useCallback((date: string, close: number) => {
    // Only works on daily/weekly/monthly timeframes (date strings, not intraday)
    if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      setSelectedBar(prev => prev?.date === date ? null : { date, close });
    }
  }, []);

  const clearHistorical = () => setSelectedBar(null);

  // Anchored VWAP: cumulative (typical-price × volume) / cumulative volume
  // Computed client-side from the chart's OHLCV bars; only works on daily/weekly bars.
  const anchoredVwapSeries = useMemo((): ChartLineSeries[] => {
    if (!showVwap || !ohlcv || ohlcv.length < 10) return [];
    const dailyBars = ohlcv.filter(b => b.time.length === 10); // skip intraday timestamps
    if (dailyBars.length < 5) return [];
    const ANCHOR_BARS: Record<string, number> = { "3M": 65, "6M": 130, "1Y": 252 };
    const bars = dailyBars.slice(-Math.min(dailyBars.length, ANCHOR_BARS[vwapAnchor]));
    let cumTPV = 0, cumVol = 0;
    const points: { time: string; value: number }[] = [];
    for (const bar of bars) {
      const tp = (bar.high + bar.low + bar.close) / 3;
      cumTPV += tp * bar.volume;
      cumVol += bar.volume;
      if (cumVol > 0) points.push({ time: bar.time, value: Math.round(cumTPV / cumVol * 100) / 100 });
    }
    if (points.length < 2) return [];
    return [{ label: `AVWAP·${vwapAnchor}`, color: "rgba(99,102,241,0.90)", lineStyle: "solid", lineWidth: 1, data: points }];
  }, [showVwap, vwapAnchor, ohlcv]);

  // Score timeline — fetched from backtest IC endpoint when on 1M view.
  // Resets when ticker changes, re-fetches when switching to/from 1M.
  useEffect(() => {
    if (timeframe.period !== "1mo" || !ticker) {
      setScoreTimeline(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=5`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (cancelled || !d?.timeline) return;
        setScoreTimeline(d.timeline as { date: string; score: number }[]);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ticker, timeframe.period]);

  // Per-bar score overlay: map each daily score to all matching 60m bars on that date.
  // This produces a flat "step" per trading day — fully aligned with the chart's time scale.
  const scoreOverlayData = useMemo((): ScoreOverlayPoint[] => {
    if (timeframe.period !== "1mo" || !ohlcv || !scoreTimeline) return [];
    const scoreByDate = new Map(scoreTimeline.map(p => [p.date, p.score]));
    const result: ScoreOverlayPoint[] = [];
    for (const bar of ohlcv) {
      const date = bar.time.length === 10 ? bar.time : bar.time.slice(0, 10);
      const score = scoreByDate.get(date);
      if (score !== undefined) result.push({ time: bar.time, score });
    }
    return result;
  }, [timeframe.period, ohlcv, scoreTimeline]);

  // Which analysis to display (historical takes priority when selected)
  const isHistoricalMode = !!selectedBar;
  const displayAnalysis = isHistoricalMode ? historicalAnalysis : analysis;
  const displayLoading = isHistoricalMode ? historicalLoading : analysisLoading;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Panel */}
      <div className="w-64 shrink-0 flex flex-col h-full">
        <WatchlistSidebar />
      </div>

      {/* Center Panel */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border h-full overflow-y-auto">
        <div className="p-4 border-b border-border bg-card">
          <form onSubmit={handleSearch} className="flex gap-4 flex-wrap items-center">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Enter Ticker..."
                className="pl-9 font-mono uppercase bg-background border-border focus-visible:ring-primary h-9"
              />
            </div>
            {displayAnalysis && (
              <div className="flex items-center gap-4 text-sm font-mono">
                <div>
                  <span className="text-muted-foreground mr-2">LAST</span>
                  <span className="text-lg font-bold">{formatCurrency(displayAnalysis.quote.price)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-2">CHG</span>
                  <span className={displayAnalysis.quote.change >= 0 ? "text-success" : "text-destructive"}>
                    {displayAnalysis.quote.change >= 0 ? "+" : ""}{formatCurrency(displayAnalysis.quote.change)} ({formatPercent(displayAnalysis.quote.changePercent)})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-2">VOL</span>
                  <span>{formatNumber(displayAnalysis.quote.volume, true)}</span>
                </div>
                {/* Extended hours badge */}
                {(() => {
                  const q = displayAnalysis.quote;
                  const state = q.marketState;
                  if (state === "PRE" && q.preMarketPrice && q.preMarketChangePercent != null) {
                    const sign = q.preMarketChangePercent >= 0 ? "+" : "";
                    return (
                      <div className="flex items-center gap-1.5 border border-indigo-500/40 bg-indigo-500/10 rounded px-2 py-0.5">
                        <span className="text-[10px] text-indigo-400 font-bold tracking-wide">PRE</span>
                        <span className="text-indigo-200 font-bold">{formatCurrency(q.preMarketPrice)}</span>
                        <span className={q.preMarketChangePercent >= 0 ? "text-success text-xs" : "text-destructive text-xs"}>
                          {sign}{q.preMarketChangePercent.toFixed(2)}%
                        </span>
                      </div>
                    );
                  }
                  if ((state === "POST" || state === "POSTPOST" || state === "CLOSED") && q.postMarketPrice && q.postMarketChangePercent != null) {
                    const sign = q.postMarketChangePercent >= 0 ? "+" : "";
                    return (
                      <div className="flex items-center gap-1.5 border border-amber-500/40 bg-amber-500/10 rounded px-2 py-0.5">
                        <span className="text-[10px] text-amber-400 font-bold tracking-wide">AH</span>
                        <span className="text-amber-200 font-bold">{formatCurrency(q.postMarketPrice)}</span>
                        <span className={q.postMarketChangePercent >= 0 ? "text-success text-xs" : "text-destructive text-xs"}>
                          {sign}{q.postMarketChangePercent.toFixed(2)}%
                        </span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </form>
        </div>

        <div className="flex-1 p-4 flex flex-col gap-6">
          {/* Chart Section */}
          <div className="h-[455px] bg-card border border-border rounded-md overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-muted-foreground tracking-wider shrink-0">
                {ticker} · {timeframe.label} · {timeframe.interval.toUpperCase()}
              </span>
              <div className="flex items-center gap-0.5">
                {TIMEFRAMES.map(tf => (
                  <button
                    key={tf.label}
                    onClick={() => { setTimeframe(tf); setSelectedBar(null); }}
                    className={cn(
                      "px-2 py-0.5 text-xs font-mono font-bold rounded transition-colors",
                      timeframe.label === tf.label
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              {/* Anchored VWAP toggle — only useful on daily bars */}
              {["3mo","6mo","1y","2y","5y","max"].includes(timeframe.period) && (
                <div className="flex items-center gap-0.5 border-l border-border pl-2 ml-1">
                  <button
                    onClick={() => setShowVwap(v => !v)}
                    className={cn(
                      "px-2 py-0.5 text-[10px] font-mono font-bold rounded transition-colors",
                      showVwap ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    AVWAP
                  </button>
                  {showVwap && (["3M","6M","1Y"] as const).map(a => (
                    <button
                      key={a}
                      onClick={() => setVwapAnchor(a)}
                      className={cn(
                        "px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors",
                        vwapAnchor === a
                          ? "bg-indigo-500/30 text-indigo-300"
                          : "text-muted-foreground/60 hover:text-muted-foreground"
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              )}
              <span className="text-xs text-muted-foreground font-mono shrink-0">{ohlcv?.length || 0} BARS</span>
            </div>
            <ChartBacktestStrip
              ticker={ticker}
              currentScore={displayAnalysis?.atlasScore.overall}
            />
            <div className="flex-1">
              {ohlcvLoading ? (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">LOADING CHART...</div>
              ) : ohlcv ? (
                <LightweightChart
                  data={ohlcv}
                  height={378}
                  onCandleClick={timeframe.interval === "1d" || timeframe.interval === "1wk" || timeframe.interval === "1mo" ? handleCandleClick : undefined}
                  priceLines={analysis ? buildPriceLines(analysis) : []}
                  lineSeries={anchoredVwapSeries}
                  signals={
                    // Show candle-level signal pins on 1M and shorter only (3M is too cluttered with pattern overlays)
                    ["1mo", "5d", "1d"].includes(timeframe.period) && displayAnalysis?.chartSignals
                      ? displayAnalysis.chartSignals as ChartSignalMarker[]
                      : []
                  }
                  showSwingPoints={["6mo", "1y", "2y", "5y", "max"].includes(timeframe.period)}
                  swingLookback={timeframe.period === "6mo" ? 3 : timeframe.period === "1y" ? 4 : 5}
                  patternOverlays={displayAnalysis?.patternOverlays as PatternOverlay[] ?? []}
                  scoreOverlay={scoreOverlayData}
                  extendedHours={(() => {
                    if (!displayAnalysis || timeframe.interval !== "1d") return undefined;
                    const q = displayAnalysis.quote;
                    const state = q.marketState;
                    if (state === "PRE" && q.preMarketPrice && q.preMarketChangePercent != null)
                      return { price: q.preMarketPrice, changePercent: q.preMarketChangePercent, type: "pre" } as ExtendedHoursPoint;
                    if ((state === "POST" || state === "POSTPOST" || state === "CLOSED") && q.postMarketPrice && q.postMarketChangePercent != null)
                      return { price: q.postMarketPrice, changePercent: q.postMarketChangePercent, type: "post" } as ExtendedHoursPoint;
                    return undefined;
                  })()}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">NO DATA</div>
              )}
            </div>
          </div>

          {/* Signal key — shown on 1M and shorter */}
          {displayAnalysis?.chartSignals && displayAnalysis.chartSignals.length > 0 &&
            ["1mo", "5d", "1d"].includes(timeframe.period) && (
            <div className="bg-card border border-border rounded-md p-2.5">
              <div className="text-[9px] font-mono text-muted-foreground/50 tracking-widest font-bold mb-1.5">SIGNAL KEY — hover any candle to see details</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-mono">
                {([
                  ["bull", "IB",    "inside bar"],
                  ["bull", "OB",    "outside bar"],
                  ["bull", "GAP+",  "gap up"],
                  ["bear", "GAP−",  "gap down"],
                  ["bull", "BB↑",   "BB breakout"],
                  ["bear", "BB↓",   "BB breakdown"],
                  ["bull", "BB↪",   "BB mean rev"],
                  ["bull", "RSI↑",  "oversold bounce"],
                  ["bear", "RSI↓",  "overbought peak"],
                  ["bull", "MACD↑", "MACD cross ↑"],
                  ["bear", "MACD↓", "MACD cross ↓"],
                  ["bear", "VOL",   "vol surge"],
                ] as [string, string, string][]).map(([dir, lbl, desc]) => (
                  <span key={lbl} className="flex items-center gap-1">
                    <span className={dir === "bull" ? "text-success" : "text-destructive"}>
                      {dir === "bull" ? "▲" : "▼"} {lbl}
                    </span>
                    <span className="text-muted-foreground/45">{desc}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pattern overlay legend — shown when structure overlays are active */}
          {(() => {
            const overlays = displayAnalysis?.patternOverlays as PatternOverlay[] | undefined;
            if (!overlays?.length) return null;
            return (
              <div className="space-y-2">
                {overlays.map((ov, i) => {
                  const isBull = ov.type === "bull-flag" || ov.type === "ascending-triangle";
                  const confColor = ov.confidence === "high"
                    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/8"
                    : ov.confidence === "medium"
                    ? "text-amber-400 border-amber-500/30 bg-amber-500/8"
                    : "text-muted-foreground border-border bg-card";
                  const typeColor = isBull ? "text-emerald-400 bg-emerald-500/12 border-emerald-500/25" : "text-red-400 bg-red-500/12 border-red-500/25";
                  const brkTgt = ov.targets.find(t => t.role === "breakout");
                  const t1Tgt  = ov.targets.find(t => t.role === "target");
                  const slTgt  = ov.targets.find(t => t.role === "stop");
                  const tf = (ov as PatternOverlay & { timeframe?: string }).timeframe;
                  return (
                    <div key={i} className="bg-card border border-border rounded-md p-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className={cn("text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border tracking-wider", typeColor)}>
                        {isBull ? "▲" : "▼"} {ov.label.toUpperCase()}
                      </span>
                      <span className={cn("text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-widest", confColor)}>
                        {ov.confidence.toUpperCase()}
                      </span>
                      {tf && (
                        <span className={cn(
                          "text-[8px] font-mono font-bold px-1 py-0.5 rounded tracking-widest border",
                          tf === "weekly"
                            ? "text-violet-400 border-violet-500/30 bg-violet-500/8"
                            : "text-sky-400 border-sky-500/30 bg-sky-500/8"
                        )}>
                          {tf.toUpperCase()}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/70 font-mono flex-1 min-w-0 truncate">{ov.description}</span>
                      <span className="flex gap-3 text-[10px] font-mono ml-auto">
                        {brkTgt && (
                          <span className="text-amber-400/90">
                            <span className="text-muted-foreground/40 mr-1">B/O</span>{brkTgt.price.toFixed(2)}
                          </span>
                        )}
                        {t1Tgt && (
                          <span className={isBull ? "text-emerald-400" : "text-red-400"}>
                            <span className="text-muted-foreground/40 mr-1">T1</span>{t1Tgt.price.toFixed(2)}
                          </span>
                        )}
                        {slTgt && (
                          <span className="text-red-400/80">
                            <span className="text-muted-foreground/40 mr-1">SL</span>{slTgt.price.toFixed(2)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Past Month Highlights — patterns, signal timeline, key levels */}
          {!displayLoading && displayAnalysis && (() => {
            const price      = displayAnalysis.quote.price as number;
            const res        = displayAnalysis.patterns.resistanceLevel as number | null;
            const sup        = displayAnalysis.patterns.supportLevel as number | null;
            const move       = displayAnalysis.atlasScore.expectedMovePercent;
            const dir        = displayAnalysis.atlasScore.direction;
            const allSignals = (displayAnalysis.chartSignals as ChartSignalMarker[]) ?? [];
            const cutoff     = new Date(); cutoff.setDate(cutoff.getDate() - 35);
            const recentSigs = allSignals
              .filter(s => new Date(s.date) >= cutoff)
              .sort((a, b) => a.date.localeCompare(b.date));
            const resHit = res != null && price >= res * 0.995;
            const supHit = sup != null && price <= sup * 1.005 && price >= sup * 0.995;
            const overlays   = (displayAnalysis.patternOverlays as PatternOverlay[]) ?? [];
            const t1Prices   = overlays.map(ov => ov.targets.find(t => t.role === "target")?.price).filter((v): v is number => v != null);
            const patternTgt = t1Prices.length > 0
              ? (dir === "bullish" ? Math.max(...t1Prices) : Math.min(...t1Prices))
              : null;
            const moveTgt    = price * (1 + (dir === "bullish" ? 1 : -1) * move / 100);
            const pats       = (displayAnalysis.patterns as { patterns: string[]; marketStructure?: string }).patterns ?? [];
            const mktStr     = (displayAnalysis.patterns as { marketStructure?: string }).marketStructure;
            return (
              <div className="bg-card border border-border rounded-md p-3">
                <div className="text-[9px] font-mono text-muted-foreground/50 tracking-widest font-bold mb-2.5">
                  PAST MONTH — SIGNALS &amp; TARGETS
                </div>
                <div className="flex gap-4 min-w-0">

                  {/* Patterns */}
                  <div className="flex flex-col gap-1.5 w-[140px] shrink-0">
                    <div className="text-[8px] font-mono text-muted-foreground/35 tracking-widest uppercase mb-0.5">Patterns</div>
                    {pats.length > 0 ? pats.map((p, i) => {
                      const isBull = !/bear|breakdown|head.and.shoulders|double.top/i.test(p);
                      return (
                        <span key={i} className={cn(
                          "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border tracking-wide w-fit",
                          isBull
                            ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                            : "text-red-400 bg-red-500/10 border-red-500/25"
                        )}>
                          {isBull ? "▲" : "▼"} {p}
                        </span>
                      );
                    }) : <span className="text-[9px] font-mono text-muted-foreground/40">—</span>}
                    {mktStr && (
                      <span className="mt-1 text-[8px] font-mono text-muted-foreground/40 tracking-widest uppercase">{mktStr}</span>
                    )}
                  </div>

                  {/* Signal timeline */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[8px] font-mono text-muted-foreground/35 tracking-widest uppercase mb-1.5">Signal Timeline — 35 days</div>
                    {recentSigs.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {recentSigs.map((s, i) => {
                          const isBull   = s.direction === "bull";
                          const isStrong = s.strength === "strong";
                          return (
                            <div key={i}
                              title={`${s.date} · ${s.label} · ${s.strength}`}
                              className={cn(
                                "flex flex-col items-center text-[8px] font-mono px-1.5 py-0.5 rounded border cursor-default select-none",
                                isBull
                                  ? isStrong
                                    ? "text-emerald-300 border-emerald-400/60 bg-emerald-500/12"
                                    : "text-emerald-500/70 border-emerald-500/25 bg-emerald-500/6"
                                  : isStrong
                                    ? "text-red-300 border-red-400/60 bg-red-500/12"
                                    : "text-red-500/70 border-red-500/25 bg-red-500/6"
                              )}>
                              <span className="font-bold leading-tight">{s.label}</span>
                              <span className="text-muted-foreground/50 leading-tight">{s.date.slice(5)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-[9px] font-mono text-muted-foreground/40">No signals in window</span>
                    )}
                  </div>

                  {/* Key levels */}
                  <div className="flex flex-col gap-2 w-[168px] shrink-0 border-l border-border pl-4">
                    <div className="text-[8px] font-mono text-muted-foreground/35 tracking-widest uppercase mb-0.5">Key Levels</div>
                    {res != null && (
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] font-mono text-muted-foreground/55">RESISTANCE</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-red-400 font-mono tabular-nums">${res.toFixed(2)}</span>
                          {resHit && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 tracking-wide whitespace-nowrap">HIT ✓</span>
                          )}
                        </span>
                      </div>
                    )}
                    {sup != null && (
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] font-mono text-muted-foreground/55">SUPPORT</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-emerald-400 font-mono tabular-nums">${sup.toFixed(2)}</span>
                          {supHit && (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 tracking-wide whitespace-nowrap">HELD ✓</span>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="border-t border-border/50 pt-2 space-y-1.5">
                      {patternTgt != null && (
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] font-mono text-muted-foreground/55">PATTERN TGT</span>
                          <span className="text-[12px] font-bold text-amber-400 font-mono tabular-nums">${patternTgt.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[9px] font-mono text-muted-foreground/55">MOVE TGT ±{move?.toFixed(1)}%</span>
                        <span className="text-[12px] font-bold text-warning font-mono tabular-nums">${moveTgt.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            );
          })()}

          {/* Core Analytics */}
          {displayLoading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse text-sm">
              {isHistoricalMode ? `REPLAYING ${selectedBar?.date}...` : "ANALYZING..."}
            </div>
          ) : displayAnalysis ? (
            <div className="space-y-6">
              <div className="grid grid-cols-3 xl:grid-cols-5 gap-3">
                <MiniGauge title="Trend" score={displayAnalysis.atlasScore.trendScore} />
                <MiniGauge title="Momentum" score={displayAnalysis.atlasScore.momentumScore} />
                <MiniGauge title="Volume" score={displayAnalysis.atlasScore.volumeScore} />
                <MiniGauge title="Opts Proxy" score={displayAnalysis.atlasScore.optionsScore} />
                <MiniGauge title="Rel Str" score={displayAnalysis.atlasScore.relativeStrengthScore} />
                <MiniGauge title="Gap Prob" score={calcGapProbScore(
                  displayAnalysis.volatility.atrPercent,
                  displayAnalysis.volatility.bollingerWidth,
                  displayAnalysis.volume.relativeVolume,
                  displayAnalysis.quote.previousClose && displayAnalysis.quote.open
                    ? ((displayAnalysis.quote.open - displayAnalysis.quote.previousClose) / displayAnalysis.quote.previousClose) * 100
                    : 0,
                )} />
                <MiniGauge title="Regime" score={displayAnalysis.atlasScore.marketRegimeScore} />
                <MiniGauge title="Exhaustion" score={displayAnalysis.atlasScore.exhaustionScore} />
                <MiniGauge title="Confidence" score={displayAnalysis.atlasScore.confidenceScore} />
                <MiniGauge title="Risk" score={displayAnalysis.atlasScore.riskScore} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-md p-4 space-y-4">
                  <h3 className="text-sm font-bold tracking-wider border-b border-border pb-2 text-primary">TREND ANALYSIS</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 20</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(displayAnalysis.trend.sma20)}
                        <div className={`w-2 h-2 rounded-full ${displayAnalysis.quote.price > displayAnalysis.trend.sma20 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 50</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(displayAnalysis.trend.sma50)}
                        <div className={`w-2 h-2 rounded-full ${displayAnalysis.quote.price > displayAnalysis.trend.sma50 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 200</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(displayAnalysis.trend.sma200)}
                        <div className={`w-2 h-2 rounded-full ${displayAnalysis.quote.price > displayAnalysis.trend.sma200 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ALIGNMENT</span>
                      <span className={getColorForScore(displayAnalysis.trend.trendAlignmentScore)}>{displayAnalysis.trend.trendAlignmentScore.toFixed(0)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-card border border-border rounded-md p-4 space-y-4">
                  <h3 className="text-sm font-bold tracking-wider border-b border-border pb-2 text-primary">MOMENTUM & VOLATILITY</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 font-mono">RSI (14)</div>
                      <RsiMiniChart value={displayAnalysis.momentum.rsi} height={40} />
                    </div>
                    <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">MACD</span>
                        <span className={displayAnalysis.momentum.macdHistogram > 0 ? "text-success" : "text-destructive"}>
                          {displayAnalysis.momentum.macd.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ATR</span>
                        <span>{formatCurrency(displayAnalysis.volatility.atr)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">SQUEEZE</span>
                        <span className={displayAnalysis.volatility.volatilitySqueeze ? "text-warning" : "text-muted-foreground"}>
                          {displayAnalysis.volatility.volatilitySqueeze ? "YES" : "NO"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Right Panel - Atlas Score Hero */}
      <div className="w-80 shrink-0 bg-card border-l border-border h-full flex flex-col">
        {/* Historical mode banner */}
        {isHistoricalMode && (
          <div className="flex items-center justify-between px-4 py-2 bg-warning/10 border-b border-warning/30">
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-warning" />
              <span className="text-xs font-bold font-mono text-warning tracking-wider">
                HISTORICAL · {formatDateLabel(selectedBar!.date)}
              </span>
            </div>
            <button
              onClick={clearHistorical}
              className="text-warning hover:text-warning/70 transition-colors"
              title="Return to live"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {displayLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse text-sm">
            {isHistoricalMode ? "REPLAYING..." : "CALCULATING SCORE..."}
          </div>
        ) : displayAnalysis ? (
          <>
            <div className="p-6 flex flex-col items-center border-b border-border">
              <ScoreGauge score={displayAnalysis.atlasScore.overall} size={220} strokeWidth={18} />

              <div className="mt-6 flex items-center justify-center gap-2">
                {displayAnalysis.atlasScore.direction === "bullish" ? <TrendingUp className="text-success w-6 h-6" /> :
                 displayAnalysis.atlasScore.direction === "bearish" ? <TrendingDown className="text-destructive w-6 h-6" /> :
                 <Minus className="text-muted-foreground w-6 h-6" />}
                <h2 className={cn("text-2xl font-bold uppercase tracking-widest font-mono", getColorForDirection(displayAnalysis.atlasScore.direction))}>
                  {displayAnalysis.atlasScore.label.replace("_", " ")}
                </h2>
              </div>
              <ScoreSparkline ticker={ticker} />

              {(() => {
                const cal = displayAnalysis.calibration as Record<string, unknown> | null | undefined;
                const isContrarian = cal?.isContrarian === true;
                const isAdaptive   = cal?.usingAdaptiveWeights === true;
                const isNoise      = cal?.signalQuality === "noise";
                if (!isContrarian && !isAdaptive && !isNoise) return null;
                return (
                  <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
                    {isContrarian && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider rounded border bg-amber-500/10 text-amber-400 border-amber-500/25">
                        ⚠ CONTRARIAN IC
                      </span>
                    )}
                    {isAdaptive && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider rounded border bg-primary/10 text-primary border-primary/25">
                        ◆ ADAPTIVE WEIGHTS
                      </span>
                    )}
                    {isNoise && !isContrarian && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold tracking-wider rounded border bg-zinc-700/30 text-muted-foreground border-border">
                        IC NOISE
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Weekly multi-timeframe alignment badge */}
              {!isHistoricalMode && (() => {
                const wc = (displayAnalysis as unknown as { weeklyContext?: { weeklyAlignment: string; weeklyRsi: number; weeklyTrend: string } | null })?.weeklyContext;
                if (!wc) return null;
                const colorClass =
                  wc.weeklyAlignment === "bullish"  ? "bg-success/10 text-success border-success/25" :
                  wc.weeklyAlignment === "bearish"  ? "bg-destructive/10 text-destructive border-destructive/25" :
                                                      "bg-zinc-700/20 text-muted-foreground border-border";
                const trendArrow =
                  wc.weeklyTrend === "strong_up"   ? "↑↑" :
                  wc.weeklyTrend === "up"           ? "↑"  :
                  wc.weeklyTrend === "down"         ? "↓"  :
                  wc.weeklyTrend === "strong_down"  ? "↓↓" : "→";
                return (
                  <div className="flex items-center justify-center mt-1.5">
                    <span className={cn("px-2 py-0.5 text-[9px] font-bold tracking-wider rounded border font-mono", colorClass)}
                      title={`Weekly trend: ${wc.weeklyTrend.replace("_", " ")}`}>
                      WK {trendArrow} {wc.weeklyAlignment.toUpperCase()} · RSI {wc.weeklyRsi}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div className="p-4 space-y-4 border-b border-border font-mono text-sm">
              {(() => {
                const cal = displayAnalysis.calibration;
                const isFitted   = cal?.status === "live-fit" || cal?.status === "stale-fit";
                const isPending  = cal?.status === "pending";
                const bullProb   = isFitted && cal.calibratedProbability != null
                  ? cal.calibratedProbability
                  : displayAnalysis.atlasScore.bullishProbability;
                const bearProb   = isFitted && cal.calibratedProbability != null
                  ? 100 - cal.calibratedProbability
                  : displayAnalysis.atlasScore.bearishProbability;
                return (
                  <>
                    {selectedBar && (
                      <div className="text-[10px] font-mono tracking-widest text-warning/70 -mb-1">
                        CANDLE · {selectedBar.date}
                      </div>
                    )}
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        SIGNAL STR
                        {isFitted && (
                          <span className="text-[9px] font-bold px-1 py-0.5 bg-primary/20 text-primary rounded tracking-wide">● FIT</span>
                        )}
                        {isPending && (
                          <span className="text-[9px] text-muted-foreground/50 animate-pulse tracking-wide">calibrating…</span>
                        )}
                        {!isFitted && !isPending && (
                          <span className="text-muted-foreground/40 text-[10px]">⚠</span>
                        )}
                      </span>
                      <span className="text-success font-bold">{formatPercent(bullProb)}</span>
                    </div>
                    {isFitted && (
                      <div className="text-[10px] text-muted-foreground/50 font-mono -mt-3">
                        heuristic {formatPercent(displayAnalysis.atlasScore.bullishProbability)} · fitted on {cal.observations}obs ({cal.horizon}D)
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">BEAR STR</span>
                      <span className="text-destructive font-bold">{formatPercent(bearProb)}</span>
                    </div>
                  </>
                );
              })()}
              {(() => {
                const al = displayAnalysis.atlasScore.alignmentScore ?? 100;
                const alColor = al >= 70 ? "text-success" : al >= 40 ? "text-warning" : "text-destructive";
                const alBarColor = al >= 70 ? "bg-success" : al >= 40 ? "bg-warning" : "bg-destructive";
                const alLabel = al >= 70 ? "HIGH" : al >= 40 ? "MED" : "LOW";
                return (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      FACTOR ALIGN
                      {al < 40 && (
                        <span className="text-[9px] font-bold px-1 py-0.5 bg-destructive/20 text-destructive rounded tracking-wide">⚠ MIXED</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", alBarColor)}
                          style={{ width: `${al}%` }}
                        />
                      </div>
                      <span className={cn("font-bold text-xs w-7 text-right", alColor)}>{alLabel}</span>
                    </span>
                  </div>
                );
              })()}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">EXPECTED MOVE</span>
                <span className="text-warning font-bold">
                  ±{formatPercent(displayAnalysis.atlasScore.expectedMovePercent)}
                  <span className="text-muted-foreground font-normal ml-1.5">
                    (±{formatCurrency(displayAnalysis.quote.price * displayAnalysis.atlasScore.expectedMovePercent / 100)})
                  </span>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">HORIZON</span>
                <span className="text-foreground">{displayAnalysis.atlasScore.timeHorizon.toUpperCase()}</span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              <NarrativeSection
                ticker={ticker}
                fallback={displayAnalysis.atlasScore.signalNarrative}
              />

              {/* Pullback vs Reversal panel */}
              {!isHistoricalMode && (() => {
                const ps = (displayAnalysis as unknown as { pullbackSetup?: { classification: string; pullbackScore: number; keySignals: { label: string; sentiment: string }[]; summary: string } | null })?.pullbackSetup;
                if (!ps) return null;
                const isPullback  = ps.classification === "pullback";
                const isReversal  = ps.classification === "reversal";
                const badgeClass  = isPullback  ? "bg-success/15 text-success border-success/30" :
                                    isReversal  ? "bg-destructive/15 text-destructive border-destructive/30" :
                                                  "bg-zinc-700/20 text-muted-foreground border-border";
                const barColor    = isPullback  ? "bg-success" : isReversal ? "bg-destructive" : "bg-zinc-500";
                const label       = isPullback ? "PULLBACK" : isReversal ? "REVERSAL" : "AMBIGUOUS";
                return (
                  <div className="mt-6 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-muted-foreground tracking-wider">DIP BUY vs REVERSAL</h3>
                      <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded border tracking-widest font-mono", badgeClass)}>
                        {label}
                      </span>
                    </div>
                    {/* Score bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                        <span>REVERSAL</span>
                        <span className={cn("font-bold", isPullback ? "text-success" : isReversal ? "text-destructive" : "text-muted-foreground")}>{ps.pullbackScore}/100</span>
                        <span>PULLBACK</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${ps.pullbackScore}%` }} />
                      </div>
                    </div>
                    {/* Summary */}
                    <p className="text-[10px] text-muted-foreground font-mono leading-relaxed">{ps.summary}</p>
                    {/* Key signals */}
                    <div className="space-y-1">
                      {ps.keySignals.slice(0, 5).map((sig, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[10px] font-mono">
                          <span className={cn("mt-0.5 flex-shrink-0", sig.sentiment === "bullish" ? "text-success" : sig.sentiment === "bearish" ? "text-destructive" : "text-muted-foreground")}>
                            {sig.sentiment === "bullish" ? "▲" : sig.sentiment === "bearish" ? "▼" : "—"}
                          </span>
                          <span className="text-muted-foreground">{sig.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="mt-6">
                <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-2">KEY CATALYSTS</h3>
                <ul className="list-disc pl-4 space-y-1 text-sm text-secondary-foreground">
                  {displayAnalysis.patterns.patterns.map((p: string, i: number) => (
                    <li key={i}>{p}</li>
                  ))}
                  {displayAnalysis.options.unusualActivity && (
                    <li className="text-warning">Unusual options activity detected</li>
                  )}
                </ul>
              </div>

              {!isHistoricalMode && <BacktestPanel ticker={ticker} currentScore={displayAnalysis.atlasScore.overall} />}

              {!isHistoricalMode && <RetracementPanel ticker={ticker} />}

              {!isHistoricalMode && (
                <p className="mt-4 text-xs text-muted-foreground font-mono border-t border-border pt-4">
                  CLICK ANY DAILY CANDLE TO REPLAY SCORE AT THAT DATE
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
