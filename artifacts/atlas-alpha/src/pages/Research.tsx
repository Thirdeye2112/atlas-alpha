import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { FlaskConical, TrendingUp, TrendingDown, RefreshCw, AlertCircle, ChevronUp, ChevronDown, Target } from "lucide-react";

// ─── Types matching the server response ───────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVal(val: number, unit: string): string {
  if (!isFinite(val)) return "—";
  if (unit === "0-1") return val.toFixed(2);
  if (unit === "%") return val.toFixed(1) + "%";
  if (unit === "x") return val.toFixed(2) + "x";
  if (unit === "days") return (val > 0 ? "+" : "") + val.toFixed(1);
  if (unit === "0-100") return val.toFixed(1);
  if (unit === "pts") return (val > 0 ? "+" : "") + val.toFixed(1);
  return val.toFixed(2);
}

function effectColor(effect: number, forGapType: "up" | "down"): string {
  const abs = Math.abs(effect);
  if (abs < 0.15) return "text-muted-foreground";
  // For gap-up: negative effect (stock was depressed) is bullish predictor → green
  // For gap-down: positive effect (stock was extended) is bearish → also "matches" the gap
  const aligned = forGapType === "up" ? effect < 0 : effect > 0;
  if (abs >= 0.5) return aligned ? "text-success" : "text-destructive";
  return aligned ? "text-success/70" : "text-destructive/70";
}

function effectBarWidth(effect: number): number {
  return Math.min(100, Math.abs(effect) * 50);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FactorRow({
  stat,
  direction,
}: {
  stat: FactorStat;
  direction: "up" | "down";
}) {
  const effect = direction === "up" ? stat.gapUpEffect : stat.gapDownEffect;
  const cohortMean = direction === "up" ? stat.gapUpMean : stat.gapDownMean;
  const n = direction === "up" ? stat.gapUpN : stat.gapDownN;
  const abs = Math.abs(effect);
  const barColor =
    abs >= 0.5
      ? direction === "up"
        ? effect < 0
          ? "bg-success"
          : "bg-destructive"
        : effect > 0
        ? "bg-destructive"
        : "bg-success"
      : "bg-muted-foreground/40";

  return (
    <div className="grid grid-cols-[180px_70px_70px_1fr_48px] items-center gap-1 py-1 border-b border-border/30 hover:bg-muted/20 group">
      <div className="text-xs font-medium truncate pr-1" title={stat.description}>
        {stat.label}
      </div>
      <div className="text-xs font-mono text-muted-foreground text-right">
        {fmtVal(stat.baselineMean, stat.unit)}
      </div>
      <div className={cn("text-xs font-mono text-right font-semibold", effectColor(effect, direction))}>
        {fmtVal(cohortMean, stat.unit)}
      </div>
      <div className="flex items-center gap-1 px-1">
        <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden relative">
          <div
            className={cn("absolute top-0 h-full rounded-full transition-all", barColor)}
            style={{
              width: `${effectBarWidth(effect)}%`,
              left: effect >= 0 ? "50%" : "auto",
              right: effect < 0 ? "50%" : "auto",
            }}
          />
        </div>
      </div>
      <div className={cn("text-xs font-mono text-right tabular-nums", effectColor(effect, direction))}>
        {effect >= 0 ? "+" : ""}{effect.toFixed(2)}σ
      </div>
    </div>
  );
}

function FactorTable({
  title,
  icon,
  stats,
  direction,
}: {
  title: string;
  icon: React.ReactNode;
  stats: FactorStat[];
  direction: "up" | "down";
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
        {/* Column headers */}
        <div className="grid grid-cols-[180px_70px_70px_1fr_48px] gap-1 py-1 border-b border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Factor</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Baseline</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Gap Cohort</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-1">Deviation</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide text-right">Effect</div>
        </div>
        {sorted.map(s => (
          <FactorRow key={s.factor} stat={s} direction={direction} />
        ))}
      </div>
    </div>
  );
}

function FollowThroughCard({
  title,
  icon,
  data,
  direction,
}: {
  title: string;
  icon: React.ReactNode;
  data: FollowThroughStats;
  direction: "up" | "down";
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
            (data.day5Mean < 0 ? "text-destructive" : "text-success")
          )}>
            {data.day5Mean === null ? "—" : `${data.day5Mean >= 0 ? "+" : ""}${data.day5Mean}%`}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">5-Day Return</div>
        </div>
        <div className="text-center">
          <div className="text-xl font-mono font-bold text-warning">
            {data.gapFillRate5d}%
          </div>
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
                      : <ChevronDown className="w-3 h-3 text-destructive shrink-0" />
                    }
                    <span className="font-semibold font-mono">{g.ticker}</span>
                  </div>
                </td>
                <td className="py-1 px-2 text-muted-foreground font-mono">{g.date}</td>
                <td className={cn("py-1 px-2 text-right font-mono font-bold tabular-nums",
                  g.direction === "up" ? "text-success" : "text-destructive")}>
                  {g.gapPct >= 0 ? "+" : ""}{g.gapPct}%
                </td>
                <td className="py-1 px-2 text-right font-mono tabular-nums text-muted-foreground">
                  {g.volumeX.toFixed(1)}x
                </td>
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
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? "Show fewer" : `Show all ${gaps.length} gaps`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Setup Backtest Card ───────────────────────────────────────────────────────

function SetupBacktestCard({ bt }: { bt: SetupBacktest }) {
  const lift = bt.liftRatio3d;
  const liftColor = lift >= 2.5 ? "text-success" : lift >= 1.5 ? "text-warning" : "text-muted-foreground";

  function HitBar({ rate, baseline, label }: { rate: number; baseline: number; label: string }) {
    const pct = rate * 100;
    const basePct = baseline * 100;
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
        {/* Left: hit rate bars */}
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
        {/* Right: summary stats */}
        <div className="grid grid-cols-2 gap-3 content-start">
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className={cn("text-2xl font-mono font-bold tabular-nums", liftColor)}>
              {lift.toFixed(1)}×
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Lift Ratio (3d)</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">vs random baseline</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-primary">
              {(bt.avgGapMagnitude).toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Avg Gap Magnitude</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">after setup day</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-foreground">
              {bt.gapWithin3d}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Gaps within 3d</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">of {bt.setupDays} setup days</div>
          </div>
          <div className="rounded border border-border/60 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-mono font-bold tabular-nums text-foreground">
              {(bt.randomBaseline1d * 100).toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Base Gap Rate</div>
            <div className="text-[9px] text-muted-foreground/50 mt-0.5">any day, no filter</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Legend ────────────────────────────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Research() {
  const [threshold, setThreshold] = useState<number>(5);
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

  function handleRun() {
    setThreshold(pendingThreshold);
  }

  const loading = isLoading || isFetching;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Header bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          <span className="font-display text-sm font-semibold tracking-wide">GAP PRECURSOR ANALYSIS</span>
          {data && (
            <span className="text-xs text-muted-foreground ml-2">
              {data.metadata.tickers} tickers · {data.metadata.totalGaps} gaps found ·
              ≥{data.metadata.threshold}% threshold · 1-year lookback ·
              computed {new Date(data.metadata.analyzedAt).toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
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
              loading
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {loading ? "Computing…" : data ? "Re-run" : "Run Analysis"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Initial state */}
        {!data && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <FlaskConical className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Gap Precursor Analysis</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-md">
                Analyzes ~{80} tickers over 1 year, detects all significant gaps, then correlates
                pre-gap technical conditions to find which factors consistently precede gaps.
                First run takes ~20–60s; results are cached for 6 hours.
              </p>
            </div>
            <button
              onClick={handleRun}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FlaskConical className="w-4 h-4" />
              Run Analysis
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold">Analyzing gap precursors…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fetching 1 year of data across {80}+ tickers and computing indicators.
                This may take 20–60 seconds on first run.
              </p>
            </div>
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
            {/* Stats pills */}
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

            {/* Follow-through */}
            <div className="grid grid-cols-2 gap-4">
              <FollowThroughCard
                title="Gap-Up Follow-Through"
                icon={<TrendingUp className="w-4 h-4 text-success" />}
                data={data.followThrough.gapUp}
                direction="up"
              />
              <FollowThroughCard
                title="Gap-Down Follow-Through"
                icon={<TrendingDown className="w-4 h-4 text-destructive" />}
                data={data.followThrough.gapDown}
                direction="down"
              />
            </div>

            {/* Factor rankings */}
            <div className="grid grid-cols-2 gap-4">
              <FactorTable
                title="Gap-Up Precursors"
                icon={<TrendingUp className="w-4 h-4 text-success" />}
                stats={data.factorRanking}
                direction="up"
              />
              <FactorTable
                title="Gap-Down Precursors"
                icon={<TrendingDown className="w-4 h-4 text-destructive" />}
                stats={data.factorRanking}
                direction="down"
              />
            </div>

            {/* Setup filter backtest */}
            {data.setupBacktest && (
              <SetupBacktestCard bt={data.setupBacktest} />
            )}

            {/* Recent gaps */}
            <RecentGapsTable gaps={data.recentGaps} />
          </>
        )}
      </div>
    </div>
  );
}
