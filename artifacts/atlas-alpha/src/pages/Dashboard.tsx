import React, { useState, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  useGetStockAnalysis, 
  getGetStockAnalysisQueryKey,
  OHLCVBar,
} from "@workspace/api-client-react";
import WatchlistSidebar from "@/components/layout/WatchlistSidebar";
import LightweightChart, { ChartPriceLine, ChartSignalMarker } from "@/components/charts/LightweightChart";
import ScoreGauge from "@/components/charts/ScoreGauge";
import MiniGauge from "@/components/charts/MiniGauge";
import RsiMiniChart from "@/components/charts/RsiMiniChart";
import { formatCurrency, formatPercent, formatNumber, getColorForScore, getColorForDirection } from "@/lib/formatters";
import { Search, Info, TrendingUp, TrendingDown, Minus, Clock, X, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BacktestPoint { x: number; y: number; date: string; }
interface BacktestBucket { count: number; hitRate: number | null; avgReturn: number | null; }
interface BacktestResult {
  ticker: string; horizon: number; ic: number; icRating: string;
  totalObservations: number;
  bull: BacktestBucket; neutral: BacktestBucket; bear: BacktestBucket;
  scatter: BacktestPoint[];
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

function BacktestPanel({ ticker }: { ticker: string }) {
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

  const icColor = data
    ? data.icRating === "strong" ? "text-success"
    : data.icRating === "moderate" ? "text-warning"
    : "text-muted-foreground"
    : "";

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
        <div className="space-y-3 pb-4">
          {/* Horizon selector */}
          <div className="flex items-center gap-1">
            {[5, 10, 20].map(h => (
              <button
                key={h}
                onClick={() => { setHorizon(h); run(h); }}
                className={cn(
                  "px-2 py-0.5 text-xs font-mono border rounded transition-colors",
                  horizon === h
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-foreground"
                )}
              >{h}D</button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground font-mono">fwd horizon</span>
          </div>

          {loading && (
            <div className="text-xs text-muted-foreground font-mono animate-pulse py-4 text-center">
              COMPUTING {data ? "(cached)" : "~10–20s"}…
            </div>
          )}
          {error && <div className="text-xs text-destructive font-mono">{error}</div>}

          {data && !loading && (
            <div className="space-y-3">
              {/* IC stat */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">PEARSON IC</span>
                <span className={cn("text-sm font-bold font-mono", icColor)}>
                  {data.ic > 0 ? "+" : ""}{data.ic.toFixed(3)}
                  <span className="text-xs font-normal ml-1 text-muted-foreground">({data.icRating})</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">OBSERVATIONS</span>
                <span className="text-xs font-mono">{data.totalObservations} days</span>
              </div>

              {/* Bucket hit rates */}
              <div className="space-y-1.5 pt-1">
                {[
                  { label: "BULL (≥60)", b: data.bull, positive: true, color: "text-success" },
                  { label: "NEUTRAL", b: data.neutral, positive: true, color: "text-muted-foreground" },
                  { label: "BEAR (≤40)", b: data.bear, positive: false, color: "text-destructive" },
                ].map(({ label, b, positive, color }) => (
                  <div key={label} className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                    <div className="flex-1 bg-border/30 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", positive ? "bg-success/60" : "bg-destructive/60")}
                        style={{ width: `${b.hitRate ?? 0}%` }}
                      />
                    </div>
                    <span className={cn("w-8 text-right", color)}>{b.hitRate ?? "—"}%</span>
                    <span className="text-muted-foreground/60 w-12 text-right">
                      {b.avgReturn !== null ? `${b.avgReturn > 0 ? "+" : ""}${b.avgReturn}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Scatter */}
              <div className="pt-1">
                <div className="text-xs text-muted-foreground font-mono mb-1">SCORE vs {data.horizon}D RETURN</div>
                <ScatterPlot data={data.scatter} width={236} height={110} />
              </div>

              <p className="text-xs text-muted-foreground/50 font-mono leading-relaxed pt-1">
                Walk-forward: scored daily using only prior data. IC {'>'} 0.05 = signal exists. Hit rate = % correct direction calls.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildPriceLines(data: {
  volatility: { bollingerUpper: number; bollingerLower: number };
  patterns: { supportLevel: number | null; resistanceLevel: number | null };
}): ChartPriceLine[] {
  const lines: ChartPriceLine[] = [
    { price: data.volatility.bollingerUpper, label: "BB+", color: "rgba(156,163,175,0.5)", lineStyle: "dotted" },
    { price: data.volatility.bollingerLower, label: "BB-", color: "rgba(156,163,175,0.5)", lineStyle: "dotted" },
  ];
  if (data.patterns.supportLevel)    lines.push({ price: data.patterns.supportLevel,    label: "SUP", color: "rgba(34,197,94,0.6)", lineStyle: "dashed" });
  if (data.patterns.resistanceLevel) lines.push({ price: data.patterns.resistanceLevel, label: "RES", color: "rgba(239,68,68,0.6)", lineStyle: "dashed" });
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

export default function Dashboard() {
  const searchParams = new URLSearchParams(window.location.search);
  const initialTicker = searchParams.get("ticker") || "AAPL";

  const [ticker, setTicker] = useState(initialTicker);
  const [searchInput, setSearchInput] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TF);
  const [selectedBar, setSelectedBar] = useState<{ date: string; close: number } | null>(null);

  // Live analysis
  const { data: analysis, isLoading: analysisLoading } = useGetStockAnalysis(ticker, {
    query: { enabled: !!ticker, queryKey: getGetStockAnalysisQueryKey(ticker) }
  });

  // OHLCV — custom fetch to support period/interval params
  const { data: ohlcv, isLoading: ohlcvLoading } = useQuery<OHLCVBar[]>({
    queryKey: ["ohlcv", ticker, timeframe.period, timeframe.interval],
    queryFn: async ({ signal }) => {
      const url = `/api/stock/${encodeURIComponent(ticker)}/ohlcv?period=${timeframe.period}&interval=${timeframe.interval}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("OHLCV fetch failed");
      return res.json();
    },
    enabled: !!ticker,
  });

  // Historical (point-in-time) analysis — only when a candle is clicked
  const { data: historicalAnalysis, isLoading: historicalLoading } = useQuery({
    queryKey: ["historical-analysis", ticker, selectedBar?.date],
    queryFn: async ({ signal }) => {
      const url = `/api/stock/${encodeURIComponent(ticker)}/historical-analysis?asOf=${selectedBar!.date}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error("Historical analysis failed");
      return res.json();
    },
    enabled: !!selectedBar,
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
              </div>
            )}
          </form>
        </div>

        <div className="flex-1 p-4 flex flex-col gap-6">
          {/* Chart Section */}
          <div className="h-[420px] bg-card border border-border rounded-md overflow-hidden flex flex-col">
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
              <span className="text-xs text-muted-foreground font-mono shrink-0">{ohlcv?.length || 0} BARS</span>
            </div>
            <div className="flex-1">
              {ohlcvLoading ? (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">LOADING CHART...</div>
              ) : ohlcv ? (
                <LightweightChart
                  data={ohlcv}
                  height={378}
                  onCandleClick={timeframe.interval === "1d" || timeframe.interval === "1wk" || timeframe.interval === "1mo" ? handleCandleClick : undefined}
                  priceLines={analysis ? buildPriceLines(analysis) : []}
                  signals={(timeframe.interval === "1d" || timeframe.interval === "1wk" || timeframe.interval === "1mo") && displayAnalysis?.chartSignals ? displayAnalysis.chartSignals as ChartSignalMarker[] : []}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">NO DATA</div>
              )}
            </div>
          </div>

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
                <MiniGauge title="Vol Squeeze" score={displayAnalysis.atlasScore.optionsScore} />
                <MiniGauge title="Rel Str" score={displayAnalysis.atlasScore.relativeStrengthScore} />
                <MiniGauge title="Regime" score={displayAnalysis.atlasScore.marketRegimeScore} />
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
            </div>

            <div className="p-4 space-y-4 border-b border-border font-mono text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">BULL PROB</span>
                <span className="text-success font-bold">{formatPercent(displayAnalysis.atlasScore.bullishProbability)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">BEAR PROB</span>
                <span className="text-destructive font-bold">{formatPercent(displayAnalysis.atlasScore.bearishProbability)}</span>
              </div>
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
              <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-2 flex items-center gap-2">
                <Info className="w-3 h-3" />
                SIGNAL NARRATIVE
              </h3>
              <p className="text-sm text-secondary-foreground leading-relaxed">
                {displayAnalysis.atlasScore.signalNarrative}
              </p>

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

              {!isHistoricalMode && <BacktestPanel ticker={ticker} />}

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
