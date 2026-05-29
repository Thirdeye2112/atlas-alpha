import React, { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { 
  useGetStockAnalysis, 
  getGetStockAnalysisQueryKey,
  OHLCVBar,
} from "@workspace/api-client-react";
import WatchlistSidebar from "@/components/layout/WatchlistSidebar";
import LightweightChart from "@/components/charts/LightweightChart";
import ScoreGauge from "@/components/charts/ScoreGauge";
import MiniGauge from "@/components/charts/MiniGauge";
import RsiMiniChart from "@/components/charts/RsiMiniChart";
import { formatCurrency, formatPercent, formatNumber, getColorForScore, getColorForDirection } from "@/lib/formatters";
import { Search, Info, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

const DEFAULT_TF = TIMEFRAMES[3]; // 3M / 1d

export default function Dashboard() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialTicker = searchParams.get("ticker") || "AAPL";
  
  const [ticker, setTicker] = useState(initialTicker);
  const [searchInput, setSearchInput] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState<Timeframe>(DEFAULT_TF);

  const { data: analysis, isLoading: analysisLoading } = useGetStockAnalysis(ticker, {
    query: { enabled: !!ticker, queryKey: getGetStockAnalysisQueryKey(ticker) }
  });

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      setTicker(searchInput.trim().toUpperCase());
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left Panel */}
      <div className="w-64 shrink-0 flex flex-col h-full">
        <WatchlistSidebar />
      </div>

      {/* Center Panel */}
      <div className="flex-1 flex flex-col min-w-0 border-r border-border h-full overflow-y-auto">
        <div className="p-4 border-b border-border bg-card">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Enter Ticker..."
                className="pl-9 font-mono uppercase bg-background border-border focus-visible:ring-primary h-9"
              />
            </div>
            {analysis && (
              <div className="flex items-center gap-4 text-sm font-mono">
                <div>
                  <span className="text-muted-foreground mr-2">LAST</span>
                  <span className="text-lg font-bold">{formatCurrency(analysis.quote.price)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-2">CHG</span>
                  <span className={analysis.quote.change >= 0 ? "text-success" : "text-destructive"}>
                    {analysis.quote.change >= 0 ? "+" : ""}{formatCurrency(analysis.quote.change)} ({formatPercent(analysis.quote.changePercent)})
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground mr-2">VOL</span>
                  <span>{formatNumber(analysis.quote.volume, true)}</span>
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
                    onClick={() => setTimeframe(tf)}
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
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">LOADING CHART...</div>
              ) : ohlcv ? (
                <LightweightChart data={ohlcv} height={285} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">NO DATA</div>
              )}
            </div>
          </div>

          {/* Core Analytics */}
          {analysisLoading ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse">ANALYZING...</div>
          ) : analysis ? (
            <div className="space-y-6">
              {/* 9 Gauges Grid */}
              <div className="grid grid-cols-3 xl:grid-cols-5 gap-3">
                <MiniGauge title="Trend" score={analysis.atlasScore.trendScore} />
                <MiniGauge title="Momentum" score={analysis.atlasScore.momentumScore} />
                <MiniGauge title="Volume" score={analysis.atlasScore.volumeScore} />
                <MiniGauge title="Options" score={analysis.atlasScore.optionsScore} />
                <MiniGauge title="Rel Str" score={analysis.atlasScore.relativeStrengthScore} />
                <MiniGauge title="Regime" score={analysis.atlasScore.marketRegimeScore} />
                <MiniGauge title="Confidence" score={analysis.atlasScore.confidenceScore} />
                <MiniGauge title="Risk" score={analysis.atlasScore.riskScore} />
              </div>

              {/* Technical Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Trend Analysis */}
                <div className="bg-card border border-border rounded-md p-4 space-y-4">
                  <h3 className="text-sm font-bold tracking-wider border-b border-border pb-2 text-primary">TREND ANALYSIS</h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 20</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(analysis.trend.sma20)}
                        <div className={`w-2 h-2 rounded-full ${analysis.quote.price > analysis.trend.sma20 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 50</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(analysis.trend.sma50)}
                        <div className={`w-2 h-2 rounded-full ${analysis.quote.price > analysis.trend.sma50 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">SMA 200</span>
                      <span className="flex items-center gap-1">
                        {formatCurrency(analysis.trend.sma200)}
                        <div className={`w-2 h-2 rounded-full ${analysis.quote.price > analysis.trend.sma200 ? 'bg-success' : 'bg-destructive'}`} />
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ALIGNMENT</span>
                      <span className={getColorForScore(analysis.trend.trendAlignmentScore)}>{analysis.trend.trendAlignmentScore.toFixed(0)}</span>
                    </div>
                  </div>
                </div>

                {/* Momentum Analysis */}
                <div className="bg-card border border-border rounded-md p-4 space-y-4">
                  <h3 className="text-sm font-bold tracking-wider border-b border-border pb-2 text-primary">MOMENTUM & VOLATILITY</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 font-mono">RSI (14)</div>
                      <RsiMiniChart value={analysis.momentum.rsi} height={40} />
                    </div>
                    <div className="space-y-2 text-sm font-mono">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">MACD</span>
                        <span className={analysis.momentum.macdHistogram > 0 ? "text-success" : "text-destructive"}>
                          {analysis.momentum.macd.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ATR</span>
                        <span>{formatCurrency(analysis.volatility.atr)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">SQUEEZE</span>
                        <span className={analysis.volatility.volatilitySqueeze ? "text-warning" : "text-muted-foreground"}>
                          {analysis.volatility.volatilitySqueeze ? "YES" : "NO"}
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
        {analysisLoading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground animate-pulse">CALCULATING SCORE...</div>
        ) : analysis ? (
          <>
            <div className="p-6 flex flex-col items-center border-b border-border">
              <ScoreGauge score={analysis.atlasScore.overall} size={220} strokeWidth={18} />
              
              <div className="mt-6 flex items-center justify-center gap-2">
                {analysis.atlasScore.direction === 'bullish' ? <TrendingUp className="text-success w-6 h-6" /> : 
                 analysis.atlasScore.direction === 'bearish' ? <TrendingDown className="text-destructive w-6 h-6" /> : 
                 <Minus className="text-muted-foreground w-6 h-6" />}
                <h2 className={cn("text-2xl font-bold uppercase tracking-widest font-mono", getColorForDirection(analysis.atlasScore.direction))}>
                  {analysis.atlasScore.label.replace('_', ' ')}
                </h2>
              </div>
            </div>

            <div className="p-4 space-y-4 border-b border-border font-mono text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">BULL PROB</span>
                <span className="text-success font-bold">{formatPercent(analysis.atlasScore.bullishProbability)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">BEAR PROB</span>
                <span className="text-destructive font-bold">{formatPercent(analysis.atlasScore.bearishProbability)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">EXPECTED MOVE</span>
                <span className="text-warning font-bold">±{formatPercent(analysis.atlasScore.expectedMovePercent)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">HORIZON</span>
                <span className="text-foreground">{analysis.atlasScore.timeHorizon.toUpperCase()}</span>
              </div>
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-2 flex items-center gap-2">
                <Info className="w-3 h-3" />
                SIGNAL NARRATIVE
              </h3>
              <p className="text-sm text-secondary-foreground leading-relaxed">
                {analysis.atlasScore.signalNarrative}
              </p>
              
              <div className="mt-6">
                <h3 className="text-xs font-bold text-muted-foreground tracking-wider mb-2">KEY CATALYSTS</h3>
                <ul className="list-disc pl-4 space-y-1 text-sm text-secondary-foreground">
                  {analysis.patterns.patterns.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                  {analysis.options.unusualActivity && (
                    <li className="text-warning">Unusual options activity detected</li>
                  )}
                </ul>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
