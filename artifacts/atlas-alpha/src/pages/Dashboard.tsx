import React, { useState, useCallback } from "react";
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
import { Search, Info, TrendingUp, TrendingDown, Minus, Clock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function buildPriceLines(data: {
  trend: { sma20: number; sma50: number; sma200: number };
  volatility: { bollingerUpper: number; bollingerLower: number };
  volume: { vwap: number };
  patterns: { supportLevel: number | null; resistanceLevel: number | null };
}): ChartPriceLine[] {
  const lines: ChartPriceLine[] = [
    { price: data.trend.sma20,              label: "SMA20",  color: "#60a5fa",               lineStyle: "dashed" },
    { price: data.trend.sma50,              label: "SMA50",  color: "#f97316",               lineStyle: "dashed" },
    { price: data.trend.sma200,             label: "SMA200", color: "#ef4444",               lineStyle: "dashed" },
    { price: data.volatility.bollingerUpper, label: "BB+",   color: "rgba(156,163,175,0.5)", lineStyle: "dotted" },
    { price: data.volatility.bollingerLower, label: "BB-",   color: "rgba(156,163,175,0.5)", lineStyle: "dotted" },
    { price: data.volume.vwap,              label: "VWAP",   color: "#a855f7",               lineStyle: "dashed" },
  ];
  if (data.patterns.supportLevel)    lines.push({ price: data.patterns.supportLevel,    label: "SUP", color: "rgba(34,197,94,0.6)",  lineStyle: "dashed" });
  if (data.patterns.resistanceLevel) lines.push({ price: data.patterns.resistanceLevel, label: "RES", color: "rgba(239,68,68,0.6)",  lineStyle: "dashed" });
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
          <div className="h-80 bg-card border border-border rounded-md overflow-hidden flex flex-col">
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
                  height={285}
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
                <MiniGauge title="Options" score={displayAnalysis.atlasScore.optionsScore} />
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

              {!isHistoricalMode && (
                <p className="mt-6 text-xs text-muted-foreground font-mono border-t border-border pt-4">
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
