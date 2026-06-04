import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  FlaskConical, TrendingUp, TrendingDown, RefreshCw, AlertCircle,
  ChevronUp, ChevronDown, Target, Activity, Search,
  Compass, Zap, BookOpen, ShieldAlert,
} from "lucide-react";

// ─── Gap Analysis Types ────────────────────────────────────────────────────────

interface PreGapFeatures {
  rsi: number;
  rsiTrend: number;
  macdHistPct: number;
  bbPosition: number;
  bbWidthPct: number;
  atrPct: number;
  relVol5: number;
  relVol1: number;
  consecutiveDays: number;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  prevWick: number;
  prevDayChangePct: number;
}

interface GapEventItem {
  ticker: string;
  date: string;
  gapPct: number;
  direction: "up" | "down";
  priorClose: number;
  openPrice: number;
  closePrice: number;
  volumeX: number;
  features: PreGapFeatures;
  ft1Pct: number;
  ft5Pct: number | null;
}

interface FactorStat {
  factor: string;
  label: string;
  description: string;
  unit: string;
  baselineMean: number;
  baselineStd: number;
  gapUpMean: number;
  gapDownMean: number;
  gapUpEffect: number;
  gapDownEffect: number;
  gapUpN: number;
  gapDownN: number;
  baselineN: number;
}

interface FollowThroughStats {
  n: number;
  sameDayMean: number;
  day5Mean: number | null;
  gapFillRate5d: number;
}

interface SetupBacktest {
  setupDays: number;
  gapWithin1d: number;
  gapWithin2d: number;
  gapWithin3d: number;
  hitRate1d: number;
  hitRate2d: number;
  hitRate3d: number;
  avgGapMagnitude: number;
  randomBaseline1d: number;
  liftRatio3d: number;
}

interface GapAnalysisResult {
  metadata: {
    tickers: number;
    totalGaps: number;
    gapUpCount: number;
    gapDownCount: number;
    threshold: number;
    period: string;
    analyzedAt: string;
  };
  factorRanking: FactorStat[];
  followThrough: {
    gapUp: FollowThroughStats;
    gapDown: FollowThroughStats;
  };
  recentGaps: GapEventItem[];
  setupBacktest?: SetupBacktest;
}

// ─── Run Dynamics Types ───────────────────────────────────────────────────────

interface Run {
  startTime:     string;
  direction:     "up" | "down";
  startPrice:    number;
  peakPrice:     number;
  totalMovePct:  number;
  totalBars:     number;
  durationMin:   number;
  vel3BarAvg:    number;
  firstBarPct:   number;
  retrace50Bars: number | null;
  retrace50Min:  number | null;
  rvolAtStart:   number;
}

interface RunCorrelations {
  velocityVsRetrace50:  number | null;
  distanceVsRetrace50:  number | null;
  durationVsRetrace50:  number | null;
  n: number;
}

interface RunDynamicsResult {
  ticker:    string;
  interval:  string;
  period:    string;
  totalBars: number;
  runs:      Run[];
  correlations: {
    up:   RunCorrelations;
    down: RunCorrelations;
    all:  RunCorrelations;
  };
  stats: {
    totalRuns:          number;
    upCount:            number;
    downCount:          number;
    avgMovePct:         number;
    avgDurationMin:     number;
    medianRetrace50Min: number | null;
    pctWithRetrace:     number;
  };
  insight: {
    behavior:   "momentum" | "mean-reversion" | "noisy";
    confidence: "high" | "moderate" | "low";
    summary:    string;
    keyFinding: string;
  };
  analyzedAt: string;
}

// ─── Gap Analysis Helpers ─────────────────────────────────────────────────────

function fmtVal(val: number, unit: string): string {
  if (!isFinite(val)) return "—";
  if (unit === "0-1")   return val.toFixed(2);
  if (unit === "%")     return val.toFixed(1) + "%";
  if (unit === "x")     return val.toFixed(2) + "x";
  if (unit === "days")  return (val > 0 ? "+" : "") + val.toFixed(1);
  if (unit === "0-100") return val.toFixed(1);
  if (unit === "pts")   return (val > 0 ? "+" : "") + val.toFixed(1);
  return val.toFixed(2);
}

function effectColor(effect: number, forGapType: "up" | "down"): string {
  const abs = Math.abs(effect);
  if (abs < 0.15) return "text-muted-foreground";
  const aligned = forGapType === "up" ? effect < 0 : effect > 0;
  if (abs >= 0.5) return aligned ? "text-success" : "text-destructive";
  return aligned ? "text-success/70" : "text-destructive/70";
}

function effectBarWidth(effect: number): number {
  return Math.min(100, Math.abs(effect) * 50);
}

// ─── Gap Analysis Sub-components ─────────────────────────────────────────────

function FactorRow({ stat, direction }: { stat: FactorStat; direction: "up" | "down" }) {
  const effect     = direction === "up" ? stat.gapUpEffect : stat.gapDownEffect;
  const cohortMean = direction === "up" ? stat.gapUpMean : stat.gapDownMean;
  const abs = Math.abs(effect);
  const barColor =
    abs >= 0.5
      ? direction === "up"
        ? effect < 0 ? "bg-success" : "bg-destructive"
        : effect > 0 ? "bg-destructive" : "bg-success"
      : "bg-muted-foreground/40";

  return (
    <div className="grid grid-cols-[180px_70px_70px_1fr_48px] items-center gap-1 py-1 border-b border-border/30 hover:bg-muted/20 group">
      <div className="text-xs font-medium truncate pr-1" title={stat.description}>{stat.label}</div>
      <div className="text-xs font-mono text-muted-foreground text-right">{fmtVal(stat.baselineMean, stat.unit)}</div>
      <div className={cn("text-xs font-mono text-right font-semibold", effectColor(effect, direction))}>{fmtVal(cohortMean, stat.unit)}</div>
      <div className="flex items-center gap-1 px-1">
        <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden relative">
          <div
            className={cn("absolute top-0 h-full rounded-full transition-all", barColor)}
            style={{ width: `${effectBarWidth(effect)}%`, left: effect >= 0 ? "50%" : "auto", right: effect < 0 ? "50%" : "auto" }}
          />
        </div>
      </div>
      <div className={cn("text-xs font-mono text-right tabular-nums", effectColor(effect, direction))}>
        {effect >= 0 ? "+" : ""}{effect.toFixed(2)}σ
      </div>
    </div>
  );
}

function FactorTable({ title, icon, stats, direction }: {
  title: string; icon: React.ReactNode; stats: FactorStat[]; direction: "up" | "down";
}) {
  const sorted = [...stats].sort((a, b) => {
    const ae = direction === "up" ? a.gapUpEffect : a.gapDownEffect;
    const be = direction === "up" ? b.gapUpEffect : b.gapDownEffect;
    return Math.abs(be) - Math.abs(ae);
  });
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        {icon}
        <span className="text-sm font-semibold font-display">{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">{sorted[0]?.gapUpN ?? sorted[0]?.gapDownN ?? 0} events</span>
      </div>
      <div className="px-3 py-1">
        <div className="grid grid-cols-[180px_70px_70px_1fr_48px] gap-1 py-1 border-b border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Factor</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Baseline</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Gap Cohort</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-1">Deviation</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Effect</div>
        </div>
        {sorted.map(s => <FactorRow key={s.factor} stat={s} direction={direction} />)}
      </div>
    </div>
  );
}

function FollowThroughCard({ title, icon, data, direction }: {
  title: string; icon: React.ReactNode; data: FollowThroughStats; direction: "up" | "down";
}) {
  const extendedColor = direction === "up"
    ? data.sameDayMean > 0 ? "text-success" : "text-destructive"
    : data.sameDayMean < 0 ? "text-destructive" : "text-success";
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold font-display">{title}</span>
        <span className="text-xs text-muted-foreground ml-auto">{data.n} gaps</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <div className={cn("text-xl font-mono font-bold", extendedColor)}>
            {data.sameDayMean >= 0 ? "+" : ""}{data.sameDayMean}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Same-Day (open→close)</div>
        </div>
        <div className="text-center">
          <div className={cn("text-xl font-mono font-bold",
            data.day5Mean === null ? "text-muted-foreground" :
            direction === "up" ? (data.day5Mean > 0 ? "text-success" : "text-destructive") :
            (data.day5Mean < 0 ? "text-destructive" : "text-success"))}>
            {data.day5Mean === null ? "—" : `${data.day5Mean >= 0 ? "+" : ""}${data.day5Mean}%`}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">5-Day Return</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-mono font-bold text-warning">{data.gapFillRate5d}%</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">5-Day Gap Fill Rate</div>
        </div>
      </div>
    </div>
  );
}

function RecentGapsTable({ gaps }: { gaps: GapEventItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? gaps : gaps.slice(0, 20);
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold font-display">Recent Gap Events</span>
        <span className="text-xs text-muted-foreground ml-auto">{gaps.length} total</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-muted-foreground">
              <th className="text-left py-1.5 px-3 font-medium">Ticker</th>
              <th className="text-left py-1.5 px-2 font-medium">Date</th>
              <th className="text-right py-1.5 px-2 font-medium">Gap%</th>
              <th className="text-right py-1.5 px-2 font-medium">Vol</th>
              <th className="text-right py-1.5 px-2 font-medium">RSI</th>
              <th className="text-right py-1.5 px-2 font-medium">BB%</th>
              <th className="text-right py-1.5 px-2 font-medium">SMA200%</th>
              <th className="text-right py-1.5 px-2 font-medium">Streak</th>
              <th className="text-right py-1.5 px-2 font-medium">SameDay</th>
              <th className="text-right py-1.5 px-2 font-medium">5-Day</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((g, i) => (
              <tr key={`${g.ticker}-${g.date}-${i}`} className="border-b border-border/20 hover:bg-muted/20">
                <td className="py-1 px-3">
                  <div className="flex items-center gap-1.5">
                    {g.direction === "up"
                      ? <ChevronUp className="w-3 h-3 text-success shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-destructive shrink-0" />}
                    <span className="font-semibold font-mono">{g.ticker}</span>
                  </div>
                </td>
                <td className="py-1 px-2 text-muted-foreground font-mono">{g.date}</td>
                <td className={cn("py-1 px-2 text-right font-mono font-bold tabular-nums",
                  g.direction === "up" ? "text-success" : "text-destructive")}>
                  {g.gapPct >= 0 ? "+" : ""}{g.gapPct}%
                </td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-muted-foreground">{g.volumeX.toFixed(1)}x</td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                  g.features.rsi < 30 ? "text-success" : g.features.rsi > 70 ? "text-destructive" : "text-foreground")}>
                  {g.features.rsi.toFixed(0)}
                </td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                  g.features.bbPosition < 0.2 ? "text-success" : g.features.bbPosition > 0.8 ? "text-destructive" : "text-foreground")}>
                  {g.features.bbPosition.toFixed(2)}
                </td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums text-xs",
                  g.features.priceVsSma200 < -20 ? "text-warning" :
                  g.features.priceVsSma200 > 20 ? "text-destructive/80" : "text-foreground")}>
                  {g.features.priceVsSma200 >= 0 ? "+" : ""}{g.features.priceVsSma200.toFixed(1)}%
                </td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                  g.features.consecutiveDays <= -3 ? "text-success" :
                  g.features.consecutiveDays >= 3 ? "text-destructive" : "text-muted-foreground")}>
                  {g.features.consecutiveDays > 0 ? "+" : ""}{g.features.consecutiveDays}d
                </td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                  g.ft1Pct > 0 ? "text-success/80" : "text-destructive/80")}>
                  {g.ft1Pct >= 0 ? "+" : ""}{g.ft1Pct}%
                </td>
                <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                  g.ft5Pct === null ? "text-muted-foreground" :
                  g.ft5Pct > 0 ? "text-success/80" : "text-destructive/80")}>
                  {g.ft5Pct === null ? "—" : `${g.ft5Pct >= 0 ? "+" : ""}${g.ft5Pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gaps.length > 20 && (
        <div className="px-3 py-2 border-t border-border/30">
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showAll ? "Show fewer" : `Show all ${gaps.length} gaps`}
          </button>
        </div>
      )}
    </div>
  );
}

function SetupBacktestCard({ bt }: { bt: SetupBacktest }) {
  const lift = bt.liftRatio3d;
  const liftColor = lift >= 2.5 ? "text-success" : lift >= 1.5 ? "text-warning" : "text-muted-foreground";
  function HitBar({ rate, baseline, label }: { rate: number; baseline: number; label: string }) {
    const pct = rate * 100; const basePct = baseline * 100;
    return (
      <div className="space-y-0.5">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{label}</span>
          <span className="font-mono font-semibold text-foreground">{pct.toFixed(1)}%</span>
        </div>
        <div className="relative h-2 bg-border/50 rounded-full overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-primary/50 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
          <div className="absolute top-0 h-full w-0.5 bg-warning/80" style={{ left: `${Math.min(basePct, 100)}%` }} />
        </div>
        <div className="text-[9px] text-muted-foreground/60">vs {basePct.toFixed(1)}% base rate</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Target className="w-4 h-4 text-warning" />
        <span className="text-sm font-semibold font-display">SETUP FILTER BACKTEST</span>
        <span className="text-xs text-muted-foreground ml-2">ATR≥3.2% + BB≥15% + RVOL≥1.2× filter · 1-year historical</span>
        <span className="ml-auto text-xs text-muted-foreground">{bt.setupDays} setup days identified</span>
      </div>
      <div className="p-4 grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <HitBar rate={bt.hitRate1d} baseline={bt.randomBaseline1d} label="Gap within 1 trading day" />
          <HitBar rate={bt.hitRate2d} baseline={bt.randomBaseline1d} label="Gap within 2 trading days" />
          <HitBar rate={bt.hitRate3d} baseline={bt.randomBaseline1d} label="Gap within 3 trading days" />
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground/60 pt-1">
            <div className="w-3 h-1.5 bg-primary/50 rounded-full" />
            <span>setup filter hit rate</span>
            <div className="w-0.5 h-3 bg-warning/80 ml-2" />
            <span>base rate (no filter)</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 content-start">
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className={cn("text-2xl font-mono font-bold tabular-nums", liftColor)}>{lift.toFixed(1)}×</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Lift Ratio (3d)</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">vs random baseline</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-primary">{bt.avgGapMagnitude.toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Avg Gap Magnitude</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">after setup day</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-foreground">{bt.gapWithin3d}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Gaps within 3d</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">of {bt.setupDays} setup days</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-foreground">{(bt.randomBaseline1d * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Base Gap Rate</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">any day, no filter</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EffectLegend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide">Effect σ:</span>
      <span><span className="text-muted-foreground">± &lt;0.2</span> = noise</span>
      <span><span className="text-foreground/70">± 0.2–0.5</span> = moderate signal</span>
      <span><span className="text-success font-semibold">± &gt;0.5</span> = strong predictor</span>
      <span className="ml-2 text-muted-foreground/60">Effect = (gap cohort mean − baseline) / baseline std-dev</span>
    </div>
  );
}

// ─── Run Dynamics Sub-components ─────────────────────────────────────────────

function corrColor(r: number | null): string {
  if (r === null) return "text-muted-foreground";
  const abs = Math.abs(r);
  if (abs >= 0.60) return r > 0 ? "text-success" : "text-destructive";
  if (abs >= 0.35) return r > 0 ? "text-success/70" : "text-destructive/70";
  return "text-muted-foreground";
}

function corrLabel(r: number | null): string {
  if (r === null) return "insufficient data";
  const abs = Math.abs(r);
  const dir = r > 0 ? "positive" : "negative";
  if (abs >= 0.70) return `strong ${dir}`;
  if (abs >= 0.45) return `moderate ${dir}`;
  if (abs >= 0.25) return `weak ${dir}`;
  return "noise";
}

function behaviorBadge(behavior: RunDynamicsResult["insight"]["behavior"]) {
  if (behavior === "momentum")
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/30 uppercase tracking-wider">MOMENTUM</span>;
  if (behavior === "mean-reversion")
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30 uppercase tracking-wider">MEAN-REVERSION</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border uppercase tracking-wider">NOISY</span>;
}

function confidenceBadge(confidence: RunDynamicsResult["insight"]["confidence"]) {
  const colors = { high: "text-success", moderate: "text-warning", low: "text-muted-foreground" };
  return <span className={cn("text-[10px] font-semibold uppercase tracking-wider", colors[confidence])}>{confidence} confidence</span>;
}

/** SVG scatter plot: X = total move %, Y = time to 50% retrace (min) */
function RunScatter({ runs }: { runs: Run[] }) {
  const withRetrace = runs.filter(r => r.retrace50Min !== null);
  if (withRetrace.length < 3) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        Not enough runs with confirmed retraces to plot ({withRetrace.length} of {runs.length})
      </div>
    );
  }

  const W = 360, H = 200, PAD = { l: 44, r: 12, t: 12, b: 36 };
  const xs = withRetrace.map(r => r.totalMovePct);
  const ys = withRetrace.map(r => r.retrace50Min as number);

  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(...ys) * 1.1;

  const toSvgX = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD.l - PAD.r);
  const toSvgY = (v: number) => H - PAD.b - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b);

  // Velocity quartile for dot color
  const vels = withRetrace.map(r => r.vel3BarAvg).sort((a, b) => a - b);
  const velQ1 = vels[Math.floor(vels.length * 0.33)];
  const velQ2 = vels[Math.floor(vels.length * 0.67)];
  const velColor = (r: Run) =>
    r.vel3BarAvg >= velQ2 ? "#22c55e" : r.vel3BarAvg >= velQ1 ? "#f59e0b" : "#ef4444";

  // Trend line (simple linear regression)
  const n = withRetrace.length;
  const mx = xs.reduce((a, b) => a + b) / n;
  const my = ys.reduce((a, b) => a + b) / n;
  const slope = xs.map((x, i) => (x - mx) * (ys[i] - my)).reduce((a, b) => a + b) /
                xs.map(x => (x - mx) ** 2).reduce((a, b) => a + b);
  const intercept = my - slope * mx;
  const trendY1 = intercept + slope * xMin;
  const trendY2 = intercept + slope * xMax;

  // Axis tick helpers
  const xTicks = 4;
  const yTicks = 4;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {/* Grid lines */}
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const v = yMin + (yMax - yMin) * (i / yTicks);
        const sy = toSvgY(v);
        return (
          <g key={i}>
            <line x1={PAD.l} y1={sy} x2={W - PAD.r} y2={sy} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={PAD.l - 4} y={sy + 4} textAnchor="end" fontSize={8} fill="currentColor" fillOpacity={0.5}>
              {v.toFixed(0)}m
            </text>
          </g>
        );
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const v = xMin + (xMax - xMin) * (i / xTicks);
        const sx = toSvgX(v);
        return (
          <g key={i}>
            <line x1={sx} y1={PAD.t} x2={sx} y2={H - PAD.b} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3,3" />
            <text x={sx} y={H - PAD.b + 12} textAnchor="middle" fontSize={8} fill="currentColor" fillOpacity={0.5}>
              {v.toFixed(2)}%
            </text>
          </g>
        );
      })}

      {/* Trend line */}
      <line
        x1={toSvgX(xMin)} y1={Math.max(PAD.t, Math.min(H - PAD.b, toSvgY(trendY1)))}
        x2={toSvgX(xMax)} y2={Math.max(PAD.t, Math.min(H - PAD.b, toSvgY(trendY2)))}
        stroke="white" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="4,2"
      />

      {/* Dots */}
      {withRetrace.map((r, i) => (
        <circle
          key={i}
          cx={toSvgX(r.totalMovePct)}
          cy={toSvgY(r.retrace50Min as number)}
          r={3.5}
          fill={velColor(r)}
          fillOpacity={0.80}
          stroke="black"
          strokeWidth={0.5}
        />
      ))}

      {/* Axis labels */}
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 2} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.5}>
        Run Distance (%)
      </text>
      <text
        x={8} y={(PAD.t + H - PAD.b) / 2}
        textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.5}
        transform={`rotate(-90 8 ${(PAD.t + H - PAD.b) / 2})`}
      >
        Time to 50% Retrace (min)
      </text>

      {/* Legend */}
      <g transform={`translate(${PAD.l + 4}, ${PAD.t + 4})`}>
        <rect x={0} y={0} width={96} height={32} rx={3} fill="black" fillOpacity={0.4} />
        {[["#22c55e", "Fast velocity"], ["#f59e0b", "Mid velocity"], ["#ef4444", "Slow velocity"]].map(([c, label], i) => (
          <g key={i} transform={`translate(6, ${i * 9 + 7})`}>
            <circle cx={4} cy={0} r={3} fill={c as string} />
            <text x={10} y={3.5} fontSize={7} fill="currentColor" fillOpacity={0.7}>{label as string}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function CorrRow({ label, r, description }: { label: string; r: number | null; description: string }) {
  const abs = r !== null ? Math.abs(r) : 0;
  const barW = Math.min(100, abs * 100);
  const positive = r !== null && r > 0;
  return (
    <div className="grid grid-cols-[160px_60px_1fr_120px] items-center gap-2 py-1.5 border-b border-border/30 last:border-0">
      <div className="text-xs font-medium text-foreground">{label}</div>
      <div className={cn("text-xs font-mono font-bold text-right tabular-nums", corrColor(r))}>
        {r === null ? "—" : (r >= 0 ? "+" : "") + r.toFixed(3)}
      </div>
      <div className="flex items-center gap-1">
        <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden relative">
          <div
            className={cn("absolute top-0 h-full rounded-full", abs >= 0.45 ? (positive ? "bg-success" : "bg-destructive") : "bg-muted-foreground/50")}
            style={{ width: `${barW}%`, left: positive ? "50%" : "auto", right: positive ? "auto" : `${50 - barW}%` }}
          />
        </div>
      </div>
      <div className={cn("text-[10px] text-right", corrColor(r))}>{corrLabel(r)}</div>
    </div>
  );
}

function RunsTable({ runs, interval }: { runs: Run[]; interval: string }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...runs].sort((a, b) => b.totalMovePct - a.totalMovePct);
  const visible = showAll ? sorted : sorted.slice(0, 15);
  const isDaily = interval === "1d";
  const fmtStart = (t: string) => isDaily
    ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-sm font-semibold font-display">All Detected Runs</span>
        <span className="text-xs text-muted-foreground ml-auto">{runs.length} total · sorted by magnitude</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-muted-foreground">
              <th className="text-left py-1.5 px-3 font-medium">Dir</th>
              <th className="text-right py-1.5 px-2 font-medium">Move%</th>
              <th className="text-right py-1.5 px-2 font-medium">Duration</th>
              <th className="text-right py-1.5 px-2 font-medium">Init Vel</th>
              <th className="text-right py-1.5 px-2 font-medium">RVOL</th>
              <th className="text-right py-1.5 px-2 font-medium">Retrace50</th>
              <th className="text-left py-1.5 px-2 font-medium">Start</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const isUp = r.direction === "up";
              return (
                <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                  <td className="py-1 px-3">
                    {isUp
                      ? <ChevronUp className="w-3.5 h-3.5 text-success" />
                      : <ChevronDown className="w-3.5 h-3.5 text-destructive" />}
                  </td>
                  <td className={cn("py-1 px-2 text-right font-mono font-bold tabular-nums", isUp ? "text-success" : "text-destructive")}>
                    {isUp ? "+" : "−"}{r.totalMovePct.toFixed(3)}%
                  </td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-muted-foreground">
                    {fmtDuration(r.durationMin, interval)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums text-muted-foreground">{(r.vel3BarAvg * 100).toFixed(2)}bps/bar</td>
                  <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                    r.rvolAtStart >= 2 ? "text-warning" : "text-muted-foreground")}>
                    {r.rvolAtStart.toFixed(1)}x
                  </td>
                  <td className={cn("py-1 px-2 text-right font-mono tabular-nums",
                    r.retrace50Min === null ? "text-muted-foreground" : "text-foreground")}>
                    {fmtRetrace(r.retrace50Min, interval)}
                  </td>
                  <td className="py-1 px-2 text-muted-foreground font-mono text-[10px]">
                    {fmtStart(r.startTime)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {runs.length > 15 && (
        <div className="px-3 py-2 border-t border-border/30">
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {showAll ? "Show fewer" : `Show all ${runs.length} runs`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Run Dynamics Panel ───────────────────────────────────────────────────────

const PRESET_TICKERS = ["NVDA", "JPM", "GLD", "AAPL", "TSLA", "SPY", "QQQ", "BTC-USD"];

// Per-interval period options (mirrors Yahoo Finance data limits)
const INTERVAL_PERIODS: Record<string, { value: string; label: string }[]> = {
  "1m":  [{ value: "1d",  label: "Today" }, { value: "5d", label: "5 days" }],
  "5m":  [{ value: "1d",  label: "Today" }, { value: "5d", label: "5 days" }, { value: "1mo", label: "1 month" }, { value: "2mo", label: "2 months" }],
  "15m": [{ value: "5d",  label: "5 days" }, { value: "1mo", label: "1 month" }, { value: "2mo", label: "2 months" }],
  "30m": [{ value: "5d",  label: "5 days" }, { value: "1mo", label: "1 month" }, { value: "2mo", label: "2 months" }],
  "1h":  [{ value: "1mo", label: "1 month" }, { value: "3mo", label: "3 months" }, { value: "6mo", label: "6 months" }, { value: "1y", label: "1 year" }, { value: "2y", label: "2 years" }],
  "1d":  [{ value: "3mo", label: "3 months" }, { value: "6mo", label: "6 months" }, { value: "1y", label: "1 year" }, { value: "2y", label: "2 years" }, { value: "5y", label: "5 years" }],
};

const INTERVAL_OPTIONS = [
  { value: "1m",  label: "1m",  note: "max 7d"  },
  { value: "5m",  label: "5m",  note: "max 60d" },
  { value: "15m", label: "15m", note: "max 60d" },
  { value: "30m", label: "30m", note: "max 60d" },
  { value: "1h",  label: "1h",  note: "max 2y"  },
  { value: "1d",  label: "1d",  note: "max 5y"  },
];

/** Format a retrace time (in minutes) into a human-readable string for the given interval */
function fmtRetrace(minutes: number | null, interval: string): string {
  if (minutes === null) return "still running";
  if (interval === "1d") {
    const days = minutes / 1440;
    return days < 1 ? "<1d" : `${days.toFixed(0)}d`;
  }
  if (interval === "1h") {
    const hours = minutes / 60;
    return hours < 1 ? "<1h" : `${hours.toFixed(1)}h`;
  }
  return `${minutes}m`;
}

/** Format run duration */
function fmtDuration(minutes: number, interval: string): string {
  if (interval === "1d") return `${(minutes / 1440).toFixed(0)}d`;
  if (interval === "1h" || minutes >= 120) return `${(minutes / 60).toFixed(1)}h`;
  return `${minutes}m`;
}

function RunDynamicsPanel() {
  const [ticker,   setTicker]   = useState("NVDA");
  const [input,    setInput]    = useState("NVDA");
  const [interval, setInterval] = useState("1h");
  const [period,   setPeriod]   = useState("2y");
  const [enabled,  setEnabled]  = useState(false);

  // When interval changes, default to longest available period
  function handleIntervalChange(iv: string) {
    setInterval(iv);
    const opts = INTERVAL_PERIODS[iv] ?? [];
    setPeriod(opts[opts.length - 1]?.value ?? "5d");
  }

  const { data, isLoading, isFetching, error } = useQuery<RunDynamicsResult>({
    queryKey: ["run-dynamics", ticker, period, interval],
    queryFn: async () => {
      const res = await fetch(
        `/api/research/run-dynamics?ticker=${encodeURIComponent(ticker)}&period=${period}&interval=${interval}`
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled,
    staleTime: 15 * 60 * 1000,
    retry: false,
  });

  function handleRun() {
    const t = input.trim().toUpperCase();
    if (!t) return;
    setTicker(t);
    setEnabled(true);
  }

  const loading = isLoading || isFetching;
  const corr = data?.correlations;
  const activeInterval = data?.interval ?? interval;
  const periodOpts = INTERVAL_PERIODS[interval] ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Ticker input */}
        <div className="flex items-center gap-1 bg-muted rounded border border-border overflow-hidden">
          <Search className="w-3.5 h-3.5 ml-2 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleRun()}
            placeholder="Ticker…"
            className="bg-transparent text-sm px-2 py-1.5 w-24 focus:outline-none font-mono"
          />
        </div>

        {/* Preset tickers */}
        <div className="flex items-center gap-1 flex-wrap">
          {PRESET_TICKERS.map(t => (
            <button
              key={t}
              onClick={() => { setInput(t); setTicker(t); setEnabled(true); }}
              className={cn(
                "text-xs px-2 py-1 rounded border transition-colors font-mono",
                ticker === t && data
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Interval selector */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-muted-foreground">Interval:</span>
          {INTERVAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleIntervalChange(opt.value)}
              title={opt.note}
              className={cn(
                "text-xs px-2 py-1 rounded border transition-colors font-mono",
                interval === opt.value
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Period selector */}
        <select
          value={period}
          onChange={e => setPeriod(e.target.value)}
          className="text-xs bg-muted border border-border rounded px-2 py-1.5 text-foreground focus:outline-none"
        >
          {periodOpts.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <button
          onClick={handleRun}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors",
            loading ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <Activity className={cn("w-3.5 h-3.5", loading && "animate-pulse")} />
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      {/* Data-limit note */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 -mt-2">
        <span>Yahoo Finance limits: 1m→7d · 5m/15m/30m→60d · 1h→2y · 1d→5y</span>
        <span className="text-primary/60">· Recommended for 2-year study: 1h interval</span>
      </div>

      {/* Empty state */}
      {!enabled && !data && (
        <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
          <Activity className="w-12 h-12 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-semibold text-muted-foreground">Multi-Timeframe Run Dynamics</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-lg">
              Detects every directional price run at any timeframe (1m → daily), measures initial
              velocity, total distance, and time-to-50%-retrace, then computes Pearson correlations
              to answer: does a faster or bigger move sustain longer, or retrace faster? Works on
              2 years of 1h bars or 5 years of daily bars for deep pattern studies.
            </p>
          </div>
          <div className="flex gap-2">
            {[["NVDA","1h","2y"],["JPM","1h","2y"],["GLD","1h","2y"]].map(([t, iv, p]) => (
              <button
                key={t}
                onClick={() => { setInput(t); setTicker(t); setInterval(iv); setPeriod(p); setEnabled(true); }}
                className="text-sm px-4 py-2 rounded bg-muted border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors font-mono"
              >
                {t} · {iv} · {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <RefreshCw className="w-7 h-7 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            Fetching {interval} bars ({period}) and detecting runs…
            {(interval === "1h" || interval === "1d") && " May take ~5s for long lookbacks."}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Analysis failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">{String(error)}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Insight banner */}
          <div className={cn(
            "rounded-lg border p-4 space-y-1",
            data.insight.behavior === "momentum"
              ? "border-success/30 bg-success/5"
              : data.insight.behavior === "mean-reversion"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-muted/20"
          )}>
            <div className="flex items-center gap-2">
              {behaviorBadge(data.insight.behavior)}
              {confidenceBadge(data.insight.confidence)}
              <span className="text-xs text-muted-foreground ml-auto">
                {data.totalBars} bars · {data.stats.totalRuns} runs · {data.period} @ 5m ·
                analyzed {new Date(data.analyzedAt).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-sm font-semibold">{data.insight.summary}</p>
            <p className="text-xs text-muted-foreground">{data.insight.keyFinding}</p>
          </div>

          {/* Stats pills */}
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { label: "Avg Run", value: `${data.stats.avgMovePct}%` },
              { label: "Avg Duration", value: `${data.stats.avgDurationMin}m` },
              { label: "Median Retrace50", value: data.stats.medianRetrace50Min !== null ? `${data.stats.medianRetrace50Min}m` : "—" },
              { label: "% w/ Retrace", value: `${data.stats.pctWithRetrace}%` },
              { label: "Up / Down", value: `${data.stats.upCount} / ${data.stats.downCount}` },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-1.5 bg-muted/50 border border-border rounded px-2.5 py-1 text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-mono font-semibold">{s.value}</span>
              </div>
            ))}
          </div>

          {/* Scatter + Correlations */}
          <div className="grid grid-cols-2 gap-4">
            {/* Scatter */}
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="text-sm font-semibold font-display">Distance vs Retrace Time</span>
                <span className="text-xs text-muted-foreground ml-auto">UP runs · dot color = velocity</span>
              </div>
              <div className="p-3">
                <RunScatter runs={data.runs.filter(r => r.direction === "up")} />
              </div>
            </div>

            {/* Correlations */}
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <span className="text-sm font-semibold font-display">Pearson Correlations</span>
                <span className="text-xs text-muted-foreground ml-auto">X vs time-to-50%-retrace</span>
              </div>
              <div className="px-3 pt-1 pb-2 space-y-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground py-1 font-semibold">Up Runs (n={corr?.up.n})</div>
                <CorrRow label="Init velocity" r={corr?.up.velocityVsRetrace50 ?? null} description="Faster entry → quicker retrace?" />
                <CorrRow label="Total distance %" r={corr?.up.distanceVsRetrace50 ?? null} description="Bigger move → longer run?" />
                <CorrRow label="Run duration" r={corr?.up.durationVsRetrace50 ?? null} description="Longer run → longer retrace?" />

                <div className="text-[10px] uppercase tracking-wide text-muted-foreground pt-3 pb-1 font-semibold">Down Runs (n={corr?.down.n})</div>
                <CorrRow label="Init velocity" r={corr?.down.velocityVsRetrace50 ?? null} description="" />
                <CorrRow label="Total distance %" r={corr?.down.distanceVsRetrace50 ?? null} description="" />
                <CorrRow label="Run duration" r={corr?.down.durationVsRetrace50 ?? null} description="" />

                <div className="text-[10px] uppercase tracking-wide text-muted-foreground pt-3 pb-1 font-semibold">All Runs (n={corr?.all.n})</div>
                <CorrRow label="Init velocity" r={corr?.all.velocityVsRetrace50 ?? null} description="" />
                <CorrRow label="Total distance %" r={corr?.all.distanceVsRetrace50 ?? null} description="" />
                <CorrRow label="Run duration" r={corr?.all.durationVsRetrace50 ?? null} description="" />
              </div>

              {/* Interpretation guide */}
              <div className="px-3 py-2 border-t border-border/30 text-[10px] text-muted-foreground space-y-0.5">
                <div><span className="text-success font-semibold">Positive r</span> = factor predicts longer time before retracing (momentum)</div>
                <div><span className="text-destructive font-semibold">Negative r</span> = factor predicts faster retracing (mean-reversion)</div>
              </div>
            </div>
          </div>

          {/* Run table */}
          <RunsTable runs={data.runs} interval={activeInterval} />
        </>
      )}
    </div>
  );
}

// ─── Gap Analysis Panel ───────────────────────────────────────────────────────

function GapAnalysisPanel() {
  const [threshold, setThreshold]         = useState<number>(5);
  const [pendingThreshold, setPendingThreshold] = useState<number>(5);

  const { data, isLoading, isFetching, error, refetch } = useQuery<GapAnalysisResult>({
    queryKey: ["gap-analysis", threshold],
    queryFn: async () => {
      const res = await fetch(`/api/research/gap-analysis?threshold=${threshold}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  function handleRun() { setThreshold(pendingThreshold); }
  const loading = isLoading || isFetching;

  return (
    <>
      {/* Controls */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.metadata.tickers} tickers · {data.metadata.totalGaps} gaps · ≥{data.metadata.threshold}% ·
            computed {new Date(data.metadata.analyzedAt).toLocaleString()}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Min gap:</span>
          <select
            value={pendingThreshold}
            onChange={e => setPendingThreshold(Number(e.target.value))}
            className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none"
          >
            <option value={3}>≥ 3%</option>
            <option value={5}>≥ 5%</option>
            <option value={7}>≥ 7%</option>
            <option value={10}>≥ 10%</option>
          </select>
          <button
            onClick={handleRun}
            disabled={loading}
            className={cn(
              "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors",
              loading ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {loading ? "Computing…" : data ? "Re-run" : "Run Analysis"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!data && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <FlaskConical className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Gap Precursor Analysis</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-md">
                Analyzes ~{80} tickers over 1 year, detects all significant gaps, then correlates
                pre-gap technical conditions. First run takes ~20–60s; cached 6 hours.
              </p>
            </div>
            <button
              onClick={handleRun}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FlaskConical className="w-4 h-4" />Run Analysis
            </button>
          </div>
        )}

        {loading && !data && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold">Analyzing gap precursors…</p>
              <p className="text-xs text-muted-foreground mt-1">Fetching 1 year across 80+ tickers. May take 20–60s.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-destructive">Analysis failed</p>
              <p className="text-xs text-muted-foreground mt-0.5">{String(error)}</p>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 bg-success/10 border border-success/20 rounded px-2.5 py-1 text-xs">
                <ChevronUp className="w-3 h-3 text-success" />
                <span className="font-mono font-semibold text-success">{data.metadata.gapUpCount}</span>
                <span className="text-muted-foreground">gap-up events</span>
              </div>
              <div className="flex items-center gap-1.5 bg-destructive/10 border border-destructive/20 rounded px-2.5 py-1 text-xs">
                <ChevronDown className="w-3 h-3 text-destructive" />
                <span className="font-mono font-semibold text-destructive">{data.metadata.gapDownCount}</span>
                <span className="text-muted-foreground">gap-down events</span>
              </div>
              <EffectLegend />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FollowThroughCard title="Gap-Up Follow-Through" icon={<TrendingUp className="w-4 h-4 text-success" />} data={data.followThrough.gapUp} direction="up" />
              <FollowThroughCard title="Gap-Down Follow-Through" icon={<TrendingDown className="w-4 h-4 text-destructive" />} data={data.followThrough.gapDown} direction="down" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FactorTable title="Gap-Up Precursors" icon={<TrendingUp className="w-4 h-4 text-success" />} stats={data.factorRanking} direction="up" />
              <FactorTable title="Gap-Down Precursors" icon={<TrendingDown className="w-4 h-4 text-destructive" />} stats={data.factorRanking} direction="down" />
            </div>
            {data.setupBacktest && <SetupBacktestCard bt={data.setupBacktest} />}
            <RecentGapsTable gaps={data.recentGaps} />
          </>
        )}
      </div>
    </>
  );
}

// ─── Market Tendencies Types ──────────────────────────────────────────────────

interface OmniSignal {
  signal: "GREEN" | "YELLOW" | "RED";
  strength: "strong" | "moderate" | "weak";
  weeklyTrend: "bullish" | "bearish" | "neutral";
  reason: string;
  actionNote: string;
}

interface StreakInfo {
  direction: "up" | "down" | "flat";
  count: number;
  label: string;
  alert: string | null;
}

interface StreakStatRow {
  consecutiveDays: number;
  pNextReversal: number;
  pNextContinuation: number;
  n: number;
  sampleSize: "small" | "moderate" | "large";
}

interface IndexTendency {
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

interface MarketRule {
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

interface MarketTendenciesResult {
  indices: IndexTendency[];
  streakStats: { ticker: string; down: StreakStatRow[]; up: StreakStatRow[] };
  marketRules: MarketRule[];
  analyzedAt: string;
}

// ─── Market Tendencies Sub-components ────────────────────────────────────────

function OmniSignalBadge({ signal, strength }: { signal: OmniSignal["signal"]; strength: OmniSignal["strength"] }) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider border";
  if (signal === "GREEN")  return <span className={cn(base, "bg-success/15 text-success border-success/40")}>● GREEN{strength === "strong" ? " ▲▲" : strength === "moderate" ? " ▲" : ""}</span>;
  if (signal === "RED")    return <span className={cn(base, "bg-destructive/15 text-destructive border-destructive/40")}>● RED{strength === "strong" ? " ▼▼" : strength === "moderate" ? " ▼" : ""}</span>;
  return <span className={cn(base, "bg-warning/15 text-warning border-warning/40")}>◐ YELLOW — CAUTION</span>;
}

function OmniIndexCard({ idx }: { idx: IndexTendency }) {
  const priceFmt = idx.currentPrice >= 1000
    ? idx.currentPrice.toFixed(0)
    : idx.currentPrice.toFixed(2);
  const chgColor = idx.dayChangePct > 0 ? "text-success" : idx.dayChangePct < 0 ? "text-destructive" : "text-muted-foreground";
  const s50Color = idx.priceVsSma50Pct > 0 ? "text-success/80" : "text-destructive/80";
  const s200Color = idx.priceVsSma200Pct > 0 ? "text-success/80" : "text-destructive/80";
  const rsiColor = idx.rsi14 > 70 ? "text-destructive" : idx.rsi14 < 30 ? "text-success" : "text-foreground";

  // Mini sparkline
  const closes = idx.recentCloses;
  const min = Math.min(...closes), max = Math.max(...closes);
  const pts = closes.map((c, i) => {
    const x = (i / (closes.length - 1)) * 80;
    const y = 20 - ((c - min) / (max - min || 1)) * 18;
    return `${x},${y}`;
  }).join(" ");
  const sparkColor = idx.omni.signal === "GREEN" ? "#22c55e" : idx.omni.signal === "RED" ? "#ef4444" : "#f59e0b";

  return (
    <div className={cn(
      "rounded-lg border bg-card p-4 space-y-3 relative overflow-hidden",
      idx.omni.signal === "GREEN"  ? "border-success/30"  :
      idx.omni.signal === "RED"    ? "border-destructive/30" : "border-warning/30"
    )}>
      {/* Glow */}
      <div className={cn(
        "absolute inset-0 opacity-5 pointer-events-none",
        idx.omni.signal === "GREEN"  ? "bg-success"  :
        idx.omni.signal === "RED"    ? "bg-destructive" : "bg-warning"
      )} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 relative">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-bold">{idx.ticker}</span>
            <span className="text-xs text-muted-foreground">{idx.name}</span>
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="font-mono text-xl font-bold">${priceFmt}</span>
            <span className={cn("font-mono text-sm font-semibold", chgColor)}>
              {idx.dayChangePct >= 0 ? "+" : ""}{idx.dayChangePct.toFixed(2)}%
            </span>
          </div>
        </div>
        {closes.length > 2 && (
          <svg width="80" height="24" className="shrink-0 mt-1">
            <polyline points={pts} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* OMNI signal */}
      <div className="space-y-1.5 relative">
        <OmniSignalBadge signal={idx.omni.signal} strength={idx.omni.strength} />
        <p className="text-[11px] text-muted-foreground leading-relaxed">{idx.omni.reason}</p>
        <p className={cn(
          "text-[11px] font-medium leading-relaxed px-2 py-1.5 rounded border",
          idx.omni.signal === "GREEN"  ? "bg-success/8 border-success/20 text-success/90"  :
          idx.omni.signal === "RED"    ? "bg-destructive/8 border-destructive/20 text-destructive/90" :
          "bg-warning/8 border-warning/20 text-warning/90"
        )}>{idx.omni.actionNote}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-1 text-center relative">
        {[
          { label: "Streak",   val: idx.streak.label,                                    col: idx.streak.direction === "up" ? "text-success" : idx.streak.direction === "down" ? "text-destructive" : "text-muted-foreground" },
          { label: "RSI 14",   val: idx.rsi14.toFixed(0),                                col: rsiColor },
          { label: "vs 50d",   val: `${idx.priceVsSma50Pct >= 0 ? "+" : ""}${idx.priceVsSma50Pct.toFixed(1)}%`,  col: s50Color },
          { label: "vs 200d",  val: `${idx.priceVsSma200Pct >= 0 ? "+" : ""}${idx.priceVsSma200Pct.toFixed(1)}%`, col: s200Color },
        ].map(({ label, val, col }) => (
          <div key={label} className="rounded bg-muted/40 px-1 py-1.5">
            <div className={cn("text-[11px] font-mono font-semibold truncate", col)}>{val}</div>
            <div className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* Streak alert */}
      {idx.streak.alert && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-warning/10 border border-warning/30 relative">
          <ShieldAlert className="w-3 h-3 text-warning shrink-0 mt-0.5" />
          <p className="text-[10px] text-warning leading-relaxed">{idx.streak.alert}</p>
        </div>
      )}
    </div>
  );
}

function StreakStatsTable({ stats, direction }: { stats: StreakStatRow[]; direction: "down" | "up" }) {
  const dirLabel = direction === "down" ? "Consecutive DOWN Days" : "Consecutive UP Days";
  const reversalLabel = direction === "down" ? "P(Next Day UP)" : "P(Next Day DOWN)";
  const reversalColor = (p: number) => p >= 0.75 ? "text-success font-bold" : p >= 0.60 ? "text-success/80" : p >= 0.50 ? "text-foreground" : "text-muted-foreground";

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Activity className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold font-display">{dirLabel} — Reversal Probability (SPY, 2Y)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-muted-foreground">
              <th className="text-left py-1.5 px-3 font-medium">Streak Length</th>
              <th className="text-right py-1.5 px-3 font-medium">{reversalLabel}</th>
              <th className="text-right py-1.5 px-3 font-medium">P(Continues)</th>
              <th className="text-right py-1.5 px-3 font-medium">Sample (n)</th>
              <th className="text-left py-1.5 px-3 font-medium">Edge Bar</th>
            </tr>
          </thead>
          <tbody>
            {stats.map(row => (
              <tr key={row.consecutiveDays} className={cn(
                "border-b border-border/20 hover:bg-muted/20",
                row.consecutiveDays >= 5 && direction === "down" ? "bg-success/5" :
                row.consecutiveDays >= 5 && direction === "up"   ? "bg-destructive/5" : ""
              )}>
                <td className="py-1.5 px-3 font-mono font-semibold">
                  {row.consecutiveDays} day{row.consecutiveDays > 1 ? "s" : ""}
                  {row.consecutiveDays >= 5 && <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-warning/20 text-warning">RULE</span>}
                </td>
                <td className={cn("py-1.5 px-3 text-right font-mono tabular-nums text-sm", reversalColor(row.pNextReversal))}>
                  {(row.pNextReversal * 100).toFixed(0)}%
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">
                  {(row.pNextContinuation * 100).toFixed(0)}%
                </td>
                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">
                  {row.n}
                  <span className={cn("ml-1 text-[9px]", row.sampleSize === "large" ? "text-success/60" : row.sampleSize === "moderate" ? "text-warning/60" : "text-muted-foreground/50")}>
                    ({row.sampleSize})
                  </span>
                </td>
                <td className="py-1.5 px-3">
                  <div className="flex items-center gap-1">
                    <div className="h-2 bg-border/50 rounded-full overflow-hidden" style={{ width: 60 }}>
                      <div
                        className={cn("h-full rounded-full", direction === "down" ? "bg-success/60" : "bg-destructive/60")}
                        style={{ width: `${row.pNextReversal * 100}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const RULE_STATUS_CONFIG = {
  triggered:  { color: "text-success",            bg: "bg-success/10 border-success/30",            dot: "bg-success",            label: "ACTIVE"     },
  approaching:{ color: "text-warning",             bg: "bg-warning/10 border-warning/30",            dot: "bg-warning",            label: "APPROACHING"},
  watch:      { color: "text-primary",             bg: "bg-primary/10 border-primary/30",            dot: "bg-primary/70",         label: "WATCH"      },
  inactive:   { color: "text-muted-foreground",    bg: "bg-muted/20 border-border",                  dot: "bg-muted-foreground/40",label: "INACTIVE"   },
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Mean Reversion": <RefreshCw className="w-3 h-3" />,
  "Momentum":       <Zap className="w-3 h-3" />,
  "Seasonal":       <Compass className="w-3 h-3" />,
  "Volatility":     <ShieldAlert className="w-3 h-3" />,
  "Intermarket":    <TrendingUp className="w-3 h-3" />,
  "Pattern":        <Target className="w-3 h-3" />,
};

function MarketRuleCard({ rule }: { rule: MarketRule }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = RULE_STATUS_CONFIG[rule.status];

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", cfg.bg)}>
      <div className="flex items-start gap-2">
        <div className={cn("w-2 h-2 rounded-full shrink-0 mt-1", cfg.dot)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", cfg.color)}>{cfg.label}</span>
            <div className="flex items-center gap-1 text-muted-foreground">
              {CATEGORY_ICONS[rule.category]}
              <span className="text-[10px] uppercase tracking-wide">{rule.category}</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-auto">Source: {rule.source}</span>
          </div>
          <div className="font-semibold text-sm mt-0.5">{rule.name}</div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">{rule.currentValue}</div>
        </div>
      </div>

      {/* Action note — always visible */}
      <div className={cn("text-xs px-2.5 py-2 rounded border leading-relaxed font-medium", cfg.bg)}>
        {rule.actionNote}
      </div>

      {/* Expandable detail */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <BookOpen className="w-3 h-3" />
        {expanded ? "Hide detail" : "Why this matters"}
      </button>

      {expanded && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground leading-relaxed">{rule.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-muted/40 p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Threshold</div>
              <div className="text-[11px] font-mono">{rule.threshold}</div>
            </div>
            <div className="rounded bg-muted/40 p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-0.5">Historical Edge</div>
              <div className="text-[11px] font-mono">{rule.historicalEdge}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Market Tendencies Panel ──────────────────────────────────────────────────

function MarketTendenciesPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<MarketTendenciesResult>({
    queryKey: ["market-tendencies"],
    queryFn: async () => {
      const res = await fetch("/api/research/market-tendencies");
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const loading = isLoading || isFetching;
  const activeRules = data?.marketRules.filter(r => r.status !== "inactive") ?? [];
  const inactiveRules = data?.marketRules.filter(r => r.status === "inactive") ?? [];

  return (
    <>
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground">
          OMNI-style directional guidance + market tendency rules
        </span>
        {data && (
          <span className="text-xs text-muted-foreground ml-2 opacity-60">
            · updated {new Date(data.analyzedAt).toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={() => refetch()}
          disabled={loading}
          className={cn(
            "ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-medium transition-colors",
            loading ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-muted hover:bg-muted/70 text-foreground"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading && !data && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold">Computing market tendencies…</p>
              <p className="text-xs text-muted-foreground mt-1">Fetching 2 years of daily data for SPY, QQQ, IWM, DIA</p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/30 bg-destructive/10">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="text-sm font-semibold text-destructive">Failed to load</p>
              <p className="text-xs text-muted-foreground mt-0.5">{String(error)}</p>
            </div>
          </div>
        )}

        {data && (
          <>
            {/* OMNI Direction Panel */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Compass className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold font-display">OMNI DIRECTION GUIDANCE</span>
                <span className="text-xs text-muted-foreground">— weekly trend + streak + momentum context</span>
              </div>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {data.indices.map(idx => <OmniIndexCard key={idx.ticker} idx={idx} />)}
              </div>
            </div>

            {/* Active Market Rules */}
            {activeRules.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="w-4 h-4 text-warning" />
                  <span className="text-sm font-semibold font-display">ACTIVE MARKET RULES</span>
                  <span className="text-xs text-muted-foreground ml-1">({activeRules.length} rule{activeRules.length > 1 ? "s" : ""} triggered / approaching)</span>
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {activeRules.map(rule => <MarketRuleCard key={rule.id} rule={rule} />)}
                </div>
              </div>
            )}

            {/* Streak Statistics */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold font-display">CONSECUTIVE DAY REVERSAL STATISTICS</span>
                <span className="text-xs text-muted-foreground">— SPY 2-year daily data</span>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <StreakStatsTable stats={data.streakStats.down} direction="down" />
                  <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                    After N consecutive DOWN closes: what % of the time does SPY close UP the next day?
                    The 5-day rule (Oscar Carboni): "The S&P never goes down 5 days in a row without a fight."
                  </p>
                </div>
                <div>
                  <StreakStatsTable stats={data.streakStats.up} direction="up" />
                  <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
                    After N consecutive UP closes: what % of the time does SPY close DOWN the next day?
                    Extended rallies (5+ days) become increasingly at risk of distribution / profit-taking.
                  </p>
                </div>
              </div>
            </div>

            {/* Inactive Rules Library */}
            {inactiveRules.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold font-display text-muted-foreground">RULE LIBRARY</span>
                  <span className="text-xs text-muted-foreground">— currently inactive</span>
                </div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                  {inactiveRules.map(rule => <MarketRuleCard key={rule.id} rule={rule} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = "market-tendencies" | "gap-analysis" | "run-dynamics";

export default function Research() {
  const [activeTab, setActiveTab] = useState<Tab>("market-tendencies");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "market-tendencies", label: "Market Tendencies",      icon: <Compass className="w-3.5 h-3.5" /> },
    { id: "gap-analysis",      label: "Gap Precursor Analysis", icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: "run-dynamics",      label: "Run Dynamics",           icon: <Activity className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header + Tab bar */}
      <div className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <FlaskConical className="w-4 h-4 text-primary" />
          <span className="font-display text-sm font-semibold tracking-wide">RESEARCH LAB</span>
        </div>
        <div className="flex items-center gap-0 px-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 text-xs px-4 py-2 border-b-2 transition-colors font-medium",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "market-tendencies" && <MarketTendenciesPanel />}
        {activeTab === "gap-analysis"      && <GapAnalysisPanel />}
        {activeTab === "run-dynamics"      && <RunDynamicsPanel />}
      </div>
    </div>
  );
}
