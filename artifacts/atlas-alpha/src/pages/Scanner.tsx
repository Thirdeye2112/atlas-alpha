import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGetScannerTopLongs,             getGetScannerTopLongsQueryKey,
  useGetScannerTopShorts,            getGetScannerTopShortsQueryKey,
  useGetScannerBreakouts,            getGetScannerBreakoutsQueryKey,
  useGetScannerBreakdowns,           getGetScannerBreakdownsQueryKey,
  useGetScannerGammaSqueeze,         getGetScannerGammaSqueezeQueryKey,
  useGetScannerShortSqueeze,         getGetScannerShortSqueezeQueryKey,
  useGetScannerInstitutionalAccumulation, getGetScannerInstitutionalAccumulationQueryKey,
  useGetScannerMeanReversion,        getGetScannerMeanReversionQueryKey,
  useGetScannerGapSetupLong,         getGetScannerGapSetupLongQueryKey,
  useGetScannerGapSetupShort,        getGetScannerGapSetupShortQueryKey,
  useGetScannerGapUp,                getGetScannerGapUpQueryKey,
  useGetScannerGapDown,              getGetScannerGapDownQueryKey,
  useGetScannerKeyLevels,            getGetScannerKeyLevelsQueryKey,
  useGetScannerReversalShort,        getGetScannerReversalShortQueryKey,
  useGetStockOhlcv,                  getGetStockOhlcvQueryKey,
  type ScannerResponse,
  type ScannerResult,
  useRunCustomScan,
  type CustomScanInput,
  CustomScanCriterionOperator,
} from "@workspace/api-client-react";
import LightweightChart from "@/components/charts/LightweightChart";
import { formatCurrency, formatPercent, getBgColorForScore } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronUp, ChevronDown, ChevronsUpDown, FlaskConical, RotateCcw, X } from "lucide-react";
import { useMLSignals, type MLSignal } from "@/hooks/useMLSignal";
import { ScannerMLCell, ScannerMLHeader } from "@/components/ScannerMLCell";

type JarvisFilter = "ALL" | "LONG" | "SHORT" | "JARVIS";

type SortCol =
  | "ticker" | "name" | "price" | "changePercent" | "gapPercent"
  | "atlasScore" | "rsi" | "relativeVolume" | "gapSetupScore" | "keyLevelDist"
  | "rankIC" | "mlRank";
type SortDir = "asc" | "desc";

/** Polling interval while scan is in progress */
const POLL_MS = 2000;

// ── Pattern chip config ───────────────────────────────────────────────────────
const PATTERN_ABBREV: Record<string, string> = {
  "Bearish Island Reversal": "ISLAND↓",
  "Bullish Island Reversal": "ISLAND↑",
  "Rising Wedge":            "RISE WDG",
  "Falling Wedge":           "FALL WDG",
  "Bull Flag":               "FLAG↑",
  "Bear Flag":               "FLAG↓",
  "Cup and Handle":          "C&H",
  "Head and Shoulders":      "H&S",
  "Inv Head and Shoulders":  "INV H&S",
  "Ascending Triangle":      "ASC TRI",
  "Descending Triangle":     "DESC TRI",
  "Symmetrical Triangle":    "SYM TRI",
  "Double Top":              "DBL TOP",
  "Double Bottom":           "DBL BOT",
  "BB Breakout":             "BB↑",
  "BB Breakdown":            "BB↓",
  "Golden Cross":            "GOLD×",
  "Death Cross":             "DEATH×",
  "Morning Star":            "MRN★",
  "Morning Doji Star":       "MRN DOJI",
  "Evening Star":            "EVE★",
  "Evening Doji Star":       "EVE DOJI",
  "Three White Soldiers":    "3 SOLD",
  "Three Black Crows":       "3 CROW",
  "Volatility Squeeze":      "VOL SQZ",
  "NR7 Compression":         "NR7",
  "Inside Day":              "IB",
  "Distribution Top":        "DIST TOP",
  "Parabolic Rise":          "PARABOLIC",
};
const BEARISH_PATTERNS = new Set([
  "Bearish Island Reversal", "Rising Wedge", "Bear Flag",
  "Head and Shoulders", "Descending Triangle", "Double Top", "Distribution Top",
  "BB Breakdown", "Death Cross", "Evening Star", "Evening Doji Star",
  "Three Black Crows",
]);
const BULLISH_PATTERNS = new Set([
  "Bullish Island Reversal", "Falling Wedge", "Bull Flag", "Cup and Handle",
  "Inv Head and Shoulders", "Ascending Triangle", "Double Bottom",
  "BB Breakout", "Golden Cross", "Morning Star", "Morning Doji Star",
  "Three White Soldiers",
]);

function refetchInterval(query: { state: { data?: ScannerResponse } }) {
  return (!query.state.data || !query.state.data.complete) ? POLL_MS : false;
}

// ── Sort UI ──────────────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol | null; sortDir: SortDir }) {
  if (sortCol !== col) return <ChevronsUpDown className="inline w-3 h-3 ml-0.5 opacity-30" />;
  return sortDir === "asc"
    ? <ChevronUp className="inline w-3 h-3 ml-0.5 text-primary" />
    : <ChevronDown className="inline w-3 h-3 ml-0.5 text-primary" />;
}

function SortableTh({ col, label, sortCol, sortDir, onSort, className }: {
  col: SortCol; label: string; sortCol: SortCol | null; sortDir: SortDir;
  onSort: (col: SortCol) => void; className?: string;
}) {
  return (
    <th
      className={cn("px-3 py-2 cursor-pointer select-none hover:text-foreground transition-colors", className)}
      onClick={() => onSort(col)}
    >
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </th>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

function ScanProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="px-4 py-2 border-b border-border bg-muted/30 flex items-center gap-3">
      <span className="text-xs font-mono text-muted-foreground animate-pulse shrink-0">
        SCANNING MARKET…
      </span>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-muted-foreground shrink-0">
        {done} / {total}
      </span>
    </div>
  );
}

// ── Scanner chart preview ─────────────────────────────────────────────────────

function ScannerChartPreview({ row, onClose }: { row: ScannerResult; onClose: () => void }) {
  const { data: bars = [], isLoading } = useGetStockOhlcv(row.ticker, {
    query: {
      queryKey: getGetStockOhlcvQueryKey(row.ticker),
      staleTime: 5 * 60 * 1000,
    },
  });

  const up = row.changePercent >= 0;
  return (
    <div className="border-t border-border bg-zinc-950 shrink-0">
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border/40">
        <span className="font-mono font-bold text-sm text-foreground">{row.ticker}</span>
        <span className="text-muted-foreground text-xs font-mono truncate max-w-[160px]">{row.name}</span>
        <span className="font-mono tabular-nums text-sm">{formatCurrency(row.price)}</span>
        <span className={cn("font-mono tabular-nums text-xs", up ? "text-emerald-400" : "text-red-400")}>
          {formatPercent(row.changePercent)}
        </span>
        <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", getBgColorForScore(row.atlasScore))}>
          {row.atlasScore}
        </span>
        <div className="flex-1" />
        <Link
          href={`/?ticker=${row.ticker}`}
          className="text-xs font-mono text-primary/70 hover:text-primary border border-primary/25 hover:border-primary/50 rounded px-2 py-0.5 transition-colors whitespace-nowrap"
        >
          OPEN ON DASHBOARD →
        </Link>
        <button
          onClick={onClose}
          className="text-muted-foreground/40 hover:text-muted-foreground transition-colors p-0.5 ml-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div>
        {isLoading ? (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground font-mono text-xs animate-pulse">
            LOADING CHART…
          </div>
        ) : bars.length > 0 ? (
          <LightweightChart data={bars} height={200} />
        ) : (
          <div className="h-[200px] flex items-center justify-center text-muted-foreground font-mono text-xs">
            NO DATA
          </div>
        )}
      </div>
    </div>
  );
}

// ── IC entry type ─────────────────────────────────────────────────────────────

interface IcEntry { rankIC: number; rankICRating: string; icTStat: number; }

function icColor(rating: string): string {
  return rating === "strong" ? "text-success" : rating === "moderate" ? "text-warning" : "text-muted-foreground";
}

// ── Scanner table ─────────────────────────────────────────────────────────────

function ScannerTable({
  response,
  isLoading,
  showGap,
  showGapScore,
  showKeyLevel,
  autoFetch = false,
}: {
  response?: ScannerResponse;
  isLoading: boolean;
  showGap?: boolean;
  showGapScore?: boolean;
  showKeyLevel?: boolean;
  autoFetch?: boolean;
}) {
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [previewRow, setPreviewRow] = useState<ScannerResult | null>(null);
  const [jarvisFilter, setJarvisFilter] = useState<JarvisFilter>("ALL");

  // ── Backtest state ──────────────────────────────────────────────────────────
  const [icMap, setIcMap]     = useState<Map<string, IcEntry>>(new Map());
  const [btLoading, setBtLoading] = useState(false);
  const [btDone, setBtDone]   = useState(0);
  const [btTotal, setBtTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const autoFetchedRef = useRef(false);

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const data: ScannerResult[] = response?.results ?? [];
  const complete = response?.complete ?? false;
  const progress = response?.progress;
  // Check if any structurally-distorted instrument (leveraged/volatility ETF) is in results
  const hasDistorted = (data as Array<ScannerResult & { isDistorted?: boolean }>).some(r => r.isDistorted);

  const tickers = useMemo(() => data.map(r => r.ticker), [data]);

  // ML signals for Jarvis filter
  const { signalMap, getSignal } = useMLSignals(tickers);

  function passesJarvisFilter(ticker: string): boolean {
    if (jarvisFilter === "ALL") return true;
    const s = getSignal(ticker);
    if (!s.available) return false;
    const rank = s.ml_rank_percentile ?? 50;
    const dir  = s.ml_direction;
    const jg   = s.jarvis_green ?? s.omni_green;
    if (jarvisFilter === "LONG")   return jg === true  && rank > 65 && dir === "BULLISH";
    if (jarvisFilter === "SHORT")  return jg === false && rank < 35 && dir === "BEARISH";
    if (jarvisFilter === "JARVIS") return jg === true  && rank > 75;
    return true;
  }

  // Count badges
  const longCount   = tickers.filter(t => { const s = getSignal(t); return s.available && (s.jarvis_green ?? s.omni_green) === true  && (s.ml_rank_percentile ?? 50) > 65 && s.ml_direction === "BULLISH"; }).length;
  const shortCount  = tickers.filter(t => { const s = getSignal(t); return s.available && (s.jarvis_green ?? s.omni_green) === false && (s.ml_rank_percentile ?? 50) < 35 && s.ml_direction === "BEARISH"; }).length;
  const jarvisCount = tickers.filter(t => { const s = getSignal(t); return s.available && (s.jarvis_green ?? s.omni_green) === true  && (s.ml_rank_percentile ?? 50) > 75; }).length;

  const runBacktest = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setBtLoading(true);
    setBtDone(0);
    setBtTotal(tickers.length);
    setIcMap(new Map());

    const BATCH = 4;
    const newMap = new Map<string, IcEntry>();

    for (let i = 0; i < tickers.length; i += BATCH) {
      if (ctrl.signal.aborted) break;
      const batch = tickers.slice(i, i + BATCH);

      await Promise.all(batch.map(async (ticker) => {
        try {
          const r = await fetch(
            `/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=5`,
            { signal: ctrl.signal }
          );
          if (r.ok) {
            const d = await r.json();
            newMap.set(ticker, {
              rankIC: d.rankIC,
              rankICRating: d.rankICRating,
              icTStat: d.icTStat,
            });
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") return;
        }
        setBtDone(prev => prev + 1);
      }));

      // Update map progressively so values fill in as computed
      setIcMap(new Map(newMap));
    }

    setBtLoading(false);
  }, [tickers]);

  // Auto-trigger IC fetch for high-priority tabs when scan completes
  useEffect(() => {
    if (!autoFetch || !complete || data.length === 0) return;
    if (autoFetchedRef.current || btLoading || icMap.size > 0) return;
    autoFetchedRef.current = true;
    runBacktest();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, complete, data.length]);

  // ── Sort ────────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const filtered = jarvisFilter === "ALL" ? data : data.filter(r => passesJarvisFilter(r.ticker));
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortCol === "rankIC") {
        av = icMap.get(a.ticker)?.rankIC ?? -Infinity;
        bv = icMap.get(b.ticker)?.rankIC ?? -Infinity;
      } else if (sortCol === "mlRank") {
        av = getSignal(a.ticker).ml_rank_percentile ?? -Infinity;
        bv = getSignal(b.ticker).ml_rank_percentile ?? -Infinity;
      } else {
        av = a[sortCol] ?? "";
        bv = b[sortCol] ?? "";
      }
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortCol, sortDir, icMap, jarvisFilter, signalMap]);

  const thProps = { sortCol, sortDir, onSort: handleSort };

  // ── Full spinner on first load ───────────────────────────────────────────────

  if (isLoading && !response) {
    return (
      <div className="border border-border rounded-md bg-card">
        <ScanProgress done={0} total={373} />
        <div className="p-8 text-center text-muted-foreground font-mono text-sm">
          Waiting for first results…
        </div>
      </div>
    );
  }

  // ── Backtest summary counts ─────────────────────────────────────────────────

  const btStrong   = [...icMap.values()].filter(v => v.rankICRating === "strong").length;
  const btModerate = [...icMap.values()].filter(v => v.rankICRating === "moderate").length;
  const btNoise    = [...icMap.values()].filter(v => v.rankICRating === "noise").length;

  return (
    <div className="border border-border rounded-md bg-card flex flex-col overflow-hidden">
      <div className="overflow-auto flex-1 flex flex-col">
      {/* Live progress bar while scanning */}
      {!complete && progress && progress.total > 0 && (
        <ScanProgress done={progress.done} total={progress.total} />
      )}

      {/* ── Backtest action bar ────────────────────────────────────────────── */}
      {data.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border bg-zinc-950/60 flex items-center gap-3 text-xs font-mono shrink-0">
          {!btLoading && btDone === 0 && (
            <button
              onClick={runBacktest}
              className="flex items-center gap-1.5 text-primary/80 hover:text-primary border border-primary/25 rounded px-2 py-0.5 hover:bg-primary/10 transition-colors"
            >
              <FlaskConical className="w-3 h-3" />
              RUN BACKTEST (5D) · {tickers.length} tickers
            </button>
          )}

          {btLoading && (
            <>
              <span className="text-muted-foreground animate-pulse shrink-0">
                COMPUTING BACKTESTS…
              </span>
              <div className="w-40 h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 rounded-full"
                  style={{ width: `${btTotal > 0 ? (btDone / btTotal) * 100 : 0}%` }}
                />
              </div>
              <span className="text-muted-foreground shrink-0">{btDone} / {btTotal}</span>
            </>
          )}

          {!btLoading && btDone > 0 && (
            <>
              <span className="text-muted-foreground/50">{btDone}/{btTotal} computed</span>
              <span className="text-border/60">·</span>
              <span className="text-success">{btStrong} strong</span>
              <span className="text-border/60">·</span>
              <span className="text-warning">{btModerate} moderate</span>
              <span className="text-border/60">·</span>
              <span className="text-muted-foreground">{btNoise} noise</span>
              <div className="flex-1" />
              <button
                onClick={runBacktest}
                title="Re-run backtest"
                className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Jarvis filter preset buttons */}
      {data.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border bg-zinc-950/40 flex items-center gap-1.5 flex-wrap shrink-0 text-[11px] font-mono">
          {([
            { key: "ALL",    label: "All",           count: data.length,  accent: "text-muted-foreground" },
            { key: "LONG",   label: "Long Ideas",   count: longCount,    accent: "text-emerald-400" },
            { key: "SHORT",  label: "Short Ideas",  count: shortCount,   accent: "text-rose-400" },
            { key: "JARVIS", label: "Jarvis + ML",  count: jarvisCount,  accent: "text-primary" },
          ] as { key: JarvisFilter; label: string; count: number; accent: string }[]).map(f => (
            <button
              key={f.key}
              onClick={() => setJarvisFilter(f.key)}
              className={cn(
                "px-2 py-0.5 rounded border transition-colors",
                jarvisFilter === f.key
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {f.key === "LONG" ? "🟢 " : f.key === "SHORT" ? "🔴 " : f.key === "JARVIS" ? "⭐ " : ""}
              {f.label}
              <span className={cn("ml-1 opacity-70", f.accent)}>({f.count})</span>
            </button>
          ))}
        </div>
      )}

      {/* Distorted ETF disclaimer — shown when leveraged/volatility ETFs appear in results */}
      {hasDistorted && (
        <div className="px-4 py-2 border-b border-warning/20 bg-warning/5 text-[10px] font-mono text-warning/80 flex items-center gap-2">
          <span className="font-bold text-warning shrink-0">⚠ LEV/VIX PRODUCTS</span>
          <span>Results include leveraged or VIX-futures ETFs (marked LEV/VIX). These have structural daily-reset decay — Atlas Alpha scores reflect short-term momentum only. Not suitable for multi-day holds.</span>
        </div>
      )}

      {sorted.length === 0 && (data.length === 0 ? complete : true) ? (
        <div className="p-8 text-center text-muted-foreground font-mono text-sm">
          {data.length === 0 ? "NO RESULTS FOUND FOR CURRENT CRITERIA" : "NO RESULTS MATCH CURRENT FILTER"}
        </div>
      ) : (
        <table className="w-full text-sm font-mono text-left">
          <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0 z-10">
            <tr>
              <SortableTh col="ticker"         label="TICKER" className="w-20"             {...thProps} />
              <SortableTh col="name"           label="NAME"                                {...thProps} />
              <SortableTh col="price"          label="PRICE"  className="text-right w-20"  {...thProps} />
              <SortableTh col="changePercent"  label="CHG%"   className="text-right w-20"  {...thProps} />
              {showGap && <SortableTh col="gapPercent" label="GAP%" className="text-right w-20" {...thProps} />}
              <SortableTh col="atlasScore"     label="SCORE"  className="text-right w-20"  {...thProps} />
              {showGapScore && <SortableTh col="gapSetupScore" label="GAP PROB" className="text-right w-24" {...thProps} />}
              {showKeyLevel && <SortableTh col="keyLevelDist" label="DIST%" className="text-right w-20" {...thProps} />}
              <SortableTh col="rsi"            label="RSI"    className="text-right w-16"  {...thProps} />
              <SortableTh col="relativeVolume" label="RVOL"   className="text-right w-16"  {...thProps} />
              <SortableTh col="mlRank"         label="ML"     className="text-right w-20"  {...thProps} />
              <SortableTh col="rankIC"         label="IC 5D"  className="text-right w-20"  {...thProps} />
              <th className="px-3 py-2 w-36">LEVELS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map(row => {
              const ic = icMap.get(row.ticker);
              return (
                <tr
                  key={row.ticker}
                  className={cn(
                    "hover:bg-muted/30 transition-colors cursor-pointer",
                    previewRow?.ticker === row.ticker && "bg-muted/20 border-l-2 border-l-primary"
                  )}
                  onClick={() => setPreviewRow(previewRow?.ticker === row.ticker ? null : row)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/?ticker=${row.ticker}`}
                        className="text-primary font-bold hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        {row.ticker}
                      </Link>
                      {(row as ScannerResult & { isDistorted?: boolean; assetType?: string }).isDistorted && (
                        <span
                          title={
                            (row as any).assetType === "volatility-etf"
                              ? "VIX futures — extreme contango decay"
                              : "Leveraged daily-reset — structural decay"
                          }
                          className="text-[8px] font-bold px-1 rounded bg-warning/20 text-warning border border-warning/30 leading-4 cursor-help"
                        >
                          {(row as any).assetType === "volatility-etf" ? "VIX" : "LEV"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[180px]">{row.name}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(row.price)}</td>
                  <td className={cn("px-3 py-2 text-right", row.changePercent >= 0 ? "text-success" : "text-destructive")}>
                    {formatPercent(row.changePercent)}
                  </td>
                  {showGap && (
                    <td className={cn("px-3 py-2 text-right font-bold", row.gapPercent >= 0 ? "text-success" : "text-destructive")}>
                      {row.gapPercent > 0 ? "+" : ""}{row.gapPercent.toFixed(2)}%
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <span className={cn("px-1.5 py-0.5 rounded text-xs font-bold", getBgColorForScore(row.atlasScore))}>
                      {row.atlasScore}
                    </span>
                  </td>
                  {showGapScore && (
                    <td className="px-3 py-2 text-right">
                      {row.gapSetupScore != null ? (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-xs font-bold font-mono tabular-nums",
                          row.gapSetupScore >= 70 ? "bg-warning/20 text-warning" :
                          row.gapSetupScore >= 40 ? "bg-primary/20 text-primary" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {row.gapSetupScore}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  {showKeyLevel && (
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {row.keyLevelDist != null ? (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-xs font-bold",
                          row.keyLevelDist <= 0.5 ? "bg-warning/20 text-warning" :
                          row.keyLevelDist <= 1.0 ? "bg-primary/20 text-primary" :
                          "text-muted-foreground"
                        )}>
                          {row.keyLevelDist.toFixed(2)}%
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                  )}
                  <td className={cn("px-3 py-2 text-right",
                    row.rsi > 70 ? "text-destructive" : row.rsi < 30 ? "text-success" : "text-foreground")}>
                    {row.rsi.toFixed(1)}
                  </td>
                  <td className={cn("px-3 py-2 text-right", row.relativeVolume > 2 ? "text-warning" : "text-foreground")}>
                    {row.relativeVolume.toFixed(1)}x
                  </td>

                  {/* ── ML rank column ─────────────────────────────────────── */}
                  <td className="px-3 py-2 text-right">
                    <ScannerMLCell signal={getSignal(row.ticker)} showProbability={false} />
                  </td>

                  {/* ── IC 5D column ───────────────────────────────────────── */}
                  <td className="px-3 py-2 text-right">
                    {ic ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className={cn("font-bold text-xs tabular-nums", icColor(ic.rankICRating))}>
                          {ic.rankIC >= 0 ? "+" : ""}{ic.rankIC.toFixed(3)}
                        </span>
                        <span className={cn(
                          "text-[9px] font-bold tracking-wide px-1 rounded leading-[14px]",
                          ic.rankICRating === "noise"
                            ? "text-muted-foreground/40 bg-muted/30"
                            : ic.rankIC > 0
                              ? "text-success/80 bg-success/10"
                              : "text-destructive/80 bg-destructive/10"
                        )}>
                          {ic.rankICRating === "noise" ? "NOISE" : ic.rankIC > 0 ? "▲ CONF" : "▼ CONT"}
                        </span>
                      </div>
                    ) : (
                      btLoading
                        ? <span className="text-muted-foreground/30 animate-pulse text-xs">…</span>
                        : <span className="text-muted-foreground/30 text-xs">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.catalysts.slice(0, showGapScore ? 4 : 2).map((c, i) => {
                        const isEarn = c.startsWith("EARN");
                        return (
                          <span key={i} className={cn(
                            "text-xs px-1 rounded font-mono",
                            isEarn
                              ? "bg-warning/20 text-warning font-semibold"
                              : "text-muted-foreground bg-muted"
                          )}>{c}</span>
                        );
                      })}
                      {((row as ScannerResult & { patternLabels?: string[] }).patternLabels ?? []).slice(0, 3).map((p, i) => {
                        const label = PATTERN_ABBREV[p] ?? p.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 7);
                        return (
                          <span key={`p${i}`} title={p} className={cn(
                            "text-xs px-1 rounded font-mono font-semibold",
                            BEARISH_PATTERNS.has(p) ? "bg-destructive/20 text-destructive" :
                            BULLISH_PATTERNS.has(p) ? "bg-success/20 text-success" :
                            "bg-muted/60 text-muted-foreground"
                          )}>{label}</span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>
      {previewRow && (
        <ScannerChartPreview
          row={previewRow}
          onClose={() => setPreviewRow(null)}
        />
      )}
    </div>
  );
}

// ── Reversal Short Table ──────────────────────────────────────────────────────

type ReversalRow = ScannerResult & {
  reversalScore?: number | null;
  reversalTriggers?: string[] | null;
  reversalUrgency?: string | null;
};

function ReversalShortTable({ response, isLoading }: { response?: ScannerResponse; isLoading: boolean }) {
  const rows = (response?.results ?? []) as ReversalRow[];
  const complete = response?.complete ?? false;

  const urgencyColor = (u?: string | null) => {
    if (u === "extended")  return "bg-destructive/20 text-destructive border border-destructive/40";
    if (u === "confirmed") return "bg-rose-700/20 text-rose-400 border border-rose-700/40";
    return "bg-warning/15 text-warning border border-warning/30";
  };

  if (isLoading && rows.length === 0) {
    return <ScanProgress done={0} total={0} />;
  }
  if (rows.length === 0 && complete) {
    return (
      <div className="p-8 text-center text-muted-foreground font-mono text-sm">
        NO REVERSAL SHORT SETUPS DETECTED — MARKET MAY BE TRENDING CLEANLY
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      {response && !complete && <ScanProgress done={response.progress.done} total={response.progress.total} />}
      <table className="w-full text-sm font-mono text-left">
        <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0 z-10">
          <tr>
            <th className="px-3 py-2 w-24">TICKER</th>
            <th className="px-3 py-2">NAME</th>
            <th className="px-3 py-2 text-right w-20">PRICE</th>
            <th className="px-3 py-2 text-right w-20">CHG%</th>
            <th className="px-3 py-2 text-right w-20">SCORE</th>
            <th className="px-3 py-2 text-center w-28">REV SCORE</th>
            <th className="px-3 py-2 text-right w-16">RSI</th>
            <th className="px-3 py-2 text-right w-16">RVOL</th>
            <th className="px-3 py-2">REVERSAL SIGNALS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(row => (
            <tr key={row.ticker} className="hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2">
                <Link
                  href={`/?ticker=${row.ticker}`}
                  className="text-primary font-bold hover:underline"
                >
                  {row.ticker}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">{row.name}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(row.price)}</td>
              <td className={cn("px-3 py-2 text-right", row.changePercent >= 0 ? "text-success" : "text-destructive")}>
                {formatPercent(row.changePercent)}
              </td>
              <td className="px-3 py-2 text-right">
                <span className={cn("px-1.5 py-0.5 rounded text-xs font-bold", getBgColorForScore(row.atlasScore))}>
                  {row.atlasScore}
                </span>
              </td>
              <td className="px-3 py-2 text-center">
                {row.reversalScore != null ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded font-mono", urgencyColor(row.reversalUrgency))}>
                      {row.reversalScore}
                    </span>
                    <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                      {row.reversalUrgency ?? "forming"}
                    </span>
                  </div>
                ) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className={cn("px-3 py-2 text-right", row.rsi > 70 ? "text-destructive" : row.rsi < 30 ? "text-success" : "")}>
                {row.rsi.toFixed(1)}
              </td>
              <td className={cn("px-3 py-2 text-right", row.relativeVolume > 2 ? "text-warning" : "")}>
                {row.relativeVolume.toFixed(1)}x
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {(row.reversalTriggers ?? []).map((t, i) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 rounded font-mono bg-destructive/15 text-destructive/90 border border-destructive/20">
                      {t}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Custom Scan ───────────────────────────────────────────────────────────────

type CsFieldType = "number" | "enum" | "string" | "array";
interface CsFieldConfig { key: string; label: string; type: CsFieldType; options?: string[]; hint?: string }

const CS_FIELDS: CsFieldConfig[] = [
  { key: "score",             label: "Score",               type: "number", hint: "0–100" },
  { key: "trendScore",        label: "Trend Score",         type: "number", hint: "0–100" },
  { key: "momentumScore",     label: "Momentum Score",      type: "number", hint: "0–100" },
  { key: "volumeScore",       label: "Volume Score",        type: "number", hint: "0–100" },
  { key: "relStrengthScore",  label: "Rel Strength Score",  type: "number", hint: "0–100" },
  { key: "exhaustionScore",   label: "Exhaustion Score",    type: "number", hint: "0–100" },
  { key: "bullishProbability",label: "Bull Probability %",  type: "number", hint: "0–100" },
  { key: "rsi",               label: "RSI",                 type: "number", hint: "0–100" },
  { key: "stochK",            label: "Stoch K",             type: "number", hint: "0–100" },
  { key: "macd",              label: "MACD",                type: "number" },
  { key: "relativeVolume",    label: "Rel. Volume (×)",     type: "number", hint: "e.g. 1.5" },
  { key: "atrPercent",        label: "ATR %",               type: "number", hint: "e.g. 3.0" },
  { key: "bbWidthPct",        label: "BB Width %",          type: "number", hint: "e.g. 15" },
  { key: "priceVsSma50",      label: "vs SMA50 %",          type: "number", hint: "e.g. 5.0" },
  { key: "priceVsSma200",     label: "vs SMA200 %",         type: "number", hint: "e.g. 10.0" },
  { key: "changePercent",     label: "Day Change %",        type: "number", hint: "e.g. -2.0" },
  { key: "price",             label: "Price ($)",           type: "number" },
  { key: "gapPercent",        label: "Gap %",               type: "number" },
  { key: "direction",         label: "Direction",           type: "enum",   options: ["bullish", "neutral", "bearish"] },
  { key: "signalStrength",    label: "Signal Strength",     type: "enum",   options: ["strong", "moderate", "weak"] },
  { key: "exhaustion",        label: "Exhaustion Signal",   type: "enum",   options: ["none", "distribution_top", "capitulation"] },
  { key: "pullbackClass",     label: "Setup Type",          type: "enum",   options: ["pullback", "reversal", "ambiguous", "extended"] },
  { key: "patterns",          label: "Pattern",             type: "array",  hint: "e.g. Bull Flag" },
];

const CS_OPS: Record<CsFieldType, { value: string; label: string }[]> = {
  number: [
    { value: "gte",     label: "≥" },
    { value: "lte",     label: "≤" },
    { value: "gt",      label: ">" },
    { value: "lt",      label: "<" },
    { value: "eq",      label: "=" },
    { value: "neq",     label: "≠" },
    { value: "between", label: "between" },
  ],
  enum:   [{ value: "eq", label: "is" }, { value: "neq", label: "is not" }],
  string: [{ value: "eq", label: "is" }, { value: "contains", label: "contains" }, { value: "notContains", label: "not contains" }],
  array:  [{ value: "contains", label: "contains" }, { value: "notContains", label: "not contains" }],
};

interface CsPreset {
  label: string;
  color: string;
  criteria: { field: string; operator: string; value: string; value2?: string }[];
}

const CS_PRESETS: CsPreset[] = [
  {
    label: "BULL PULLBACK",
    color: "border-primary/50 text-primary hover:bg-primary/10",
    criteria: [
      { field: "score",     operator: "gte",     value: "70" },
      { field: "direction", operator: "eq",      value: "bullish" },
      { field: "rsi",       operator: "between", value: "40", value2: "65" },
    ],
  },
  {
    label: "RSI OVERSOLD",
    color: "border-success/50 text-success hover:bg-success/10",
    criteria: [
      { field: "rsi",       operator: "lte",     value: "35" },
      { field: "direction", operator: "neq",     value: "bearish" },
    ],
  },
  {
    label: "VOL BREAKOUT",
    color: "border-warning/50 text-warning hover:bg-warning/10",
    criteria: [
      { field: "score",          operator: "gte",     value: "72" },
      { field: "relativeVolume", operator: "gte",     value: "2.0" },
      { field: "rsi",            operator: "between", value: "55", value2: "80" },
    ],
  },
  {
    label: "MOMENTUM SURGE",
    color: "border-warning/50 text-warning hover:bg-warning/10",
    criteria: [
      { field: "momentumScore",  operator: "gte", value: "80" },
      { field: "relativeVolume", operator: "gte", value: "1.5" },
    ],
  },
  {
    label: "VOLATILITY SQUEEZE",
    color: "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10",
    criteria: [
      { field: "atrPercent", operator: "lte", value: "2.5" },
      { field: "bbWidthPct", operator: "lte", value: "12" },
      { field: "score",      operator: "gte", value: "60" },
    ],
  },
  {
    label: "DIST TOP FADE",
    color: "border-destructive/50 text-destructive hover:bg-destructive/10",
    criteria: [
      { field: "exhaustion", operator: "eq",  value: "distribution_top" },
      { field: "rsi",        operator: "gte", value: "65" },
    ],
  },
  {
    label: "DEEP OVERSOLD",
    color: "border-success/50 text-success hover:bg-success/10",
    criteria: [
      { field: "rsi",           operator: "lte", value: "30" },
      { field: "priceVsSma50",  operator: "lte", value: "-10" },
    ],
  },
  {
    label: "STRONG BULL",
    color: "border-primary/50 text-primary hover:bg-primary/10",
    criteria: [
      { field: "score",              operator: "gte", value: "80" },
      { field: "direction",          operator: "eq",  value: "bullish" },
      { field: "bullishProbability", operator: "gte", value: "70" },
    ],
  },
];

const CS_SORT_FIELDS = CS_FIELDS.filter(f => f.type === "number" || f.key === "direction").map(f => ({ key: f.key, label: f.label }));

let _csRowId = 0;
function csNewRow(field = "score", op?: string, val = "", val2 = ""): { id: number; field: string; operator: string; value: string; value2: string } {
  const fc = CS_FIELDS.find(f => f.key === field) ?? CS_FIELDS[0];
  const defaultOp = op ?? CS_OPS[fc.type][0].value;
  return { id: ++_csRowId, field, operator: defaultOp, value: val, value2: val2 };
}

function CustomScanTab({ onTickerClick }: { onTickerClick?: (ticker: string) => void }) {
  const [rows, setRows] = useState(() => [csNewRow()]);
  const [sortBy,  setSortBy]  = useState("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [result, setResult]   = useState<ScannerResponse | undefined>();
  const [matchCount, setMatchCount] = useState<number | undefined>();
  const [ranOnce,    setRanOnce]    = useState(false);

  const { mutate, isPending, isError } = useRunCustomScan({
    mutation: {
      onSuccess: (data) => {
        setResult(data as ScannerResponse);
        setMatchCount((data as unknown as { matchCount?: number }).matchCount);
        setRanOnce(true);
      },
    },
  });

  function buildCriteria(): CustomScanInput["criteria"] {
    return rows
      .filter(r => r.value.trim() !== "" || r.operator === "contains" || r.operator === "notContains")
      .map(r => {
        const num = parseFloat(r.value);
        const parsed: CustomScanInput["criteria"][number] = {
          field: r.field,
          operator: r.operator as CustomScanCriterionOperator,
          value: isNaN(num) ? r.value : num,
        };
        if (r.operator === "between" && r.value2.trim()) {
          (parsed as unknown as Record<string, unknown>).value2 = parseFloat(r.value2);
        }
        return parsed;
      });
  }

  function runScan() {
    const criteria = buildCriteria();
    if (criteria.length === 0) return;
    mutate({ data: { criteria, limit: 50, sortBy, sortDir } });
  }

  function applyPreset(p: CsPreset) {
    setRows(p.criteria.map(c => csNewRow(c.field, c.operator, c.value, c.value2 ?? "")));
    setResult(undefined);
    setMatchCount(undefined);
    setRanOnce(false);
  }

  function updateRow(id: number, patch: Partial<typeof rows[number]>) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, ...patch };
      // If field changed, reset operator to the first for the new type
      if (patch.field && patch.field !== r.field) {
        const fc = CS_FIELDS.find(f => f.key === patch.field) ?? CS_FIELDS[0];
        updated.operator = CS_OPS[fc.type][0].value;
        updated.value    = "";
        updated.value2   = "";
      }
      return updated;
    }));
  }

  function removeRow(id: number) {
    setRows(prev => prev.filter(r => r.id !== id));
  }

  const criteriaReady = buildCriteria().length > 0;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Quick Presets */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs font-mono text-muted-foreground mr-1">QUICK START:</span>
        {CS_PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className={cn(
              "px-2.5 py-1 rounded border text-xs font-mono transition-colors",
              p.color
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Filter builder */}
      <div className="bg-card border border-border rounded-md p-3 flex flex-col gap-2">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">Filter Criteria</div>

        {rows.length === 0 && (
          <div className="text-xs font-mono text-muted-foreground/50 italic py-2">
            No filters — add at least one criterion to run a scan.
          </div>
        )}

        {rows.map((row) => {
          const fc       = CS_FIELDS.find(f => f.key === row.field) ?? CS_FIELDS[0];
          const ops      = CS_OPS[fc.type];
          const isBetw   = row.operator === "between";
          const isEnum   = fc.type === "enum";

          return (
            <div key={row.id} className="flex items-center gap-1.5 flex-wrap">
              {/* Field selector */}
              <select
                value={row.field}
                onChange={e => updateRow(row.id, { field: e.target.value })}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary min-w-[160px]"
              >
                {CS_FIELDS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>

              {/* Operator selector */}
              <select
                value={row.operator}
                onChange={e => updateRow(row.id, { operator: e.target.value })}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary w-[110px]"
              >
                {ops.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>

              {/* Value input(s) */}
              {isEnum ? (
                <select
                  value={row.value}
                  onChange={e => updateRow(row.id, { value: e.target.value })}
                  className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary min-w-[120px]"
                >
                  <option value="">— select —</option>
                  {fc.options?.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type={fc.type === "array" ? "text" : "number"}
                    placeholder={isBetw ? "min" : (fc.hint ?? "value")}
                    value={row.value}
                    onChange={e => updateRow(row.id, { value: e.target.value })}
                    className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary w-[90px] placeholder:text-muted-foreground/40"
                  />
                  {isBetw && (
                    <>
                      <span className="text-xs text-muted-foreground font-mono">—</span>
                      <input
                        type="number"
                        placeholder="max"
                        value={row.value2}
                        onChange={e => updateRow(row.id, { value2: e.target.value })}
                        className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary w-[90px] placeholder:text-muted-foreground/40"
                      />
                    </>
                  )}
                </>
              )}

              {/* Remove */}
              <button
                onClick={() => removeRow(row.id)}
                className="ml-0.5 p-1 rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        <div className="flex items-center gap-2 mt-1 pt-2 border-t border-border/50">
          <button
            onClick={() => setRows(prev => [...prev, csNewRow()])}
            className="text-xs font-mono text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-2.5 py-1 transition-colors"
          >
            + ADD FILTER
          </button>

          {rows.length > 1 && (
            <button
              onClick={() => setRows([csNewRow()])}
              className="text-xs font-mono text-muted-foreground/50 hover:text-muted-foreground border border-border/40 hover:border-border rounded px-2.5 py-1 transition-colors"
            >
              CLEAR ALL
            </button>
          )}
        </div>
      </div>

      {/* Run controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={runScan}
          disabled={!criteriaReady || isPending}
          className={cn(
            "px-4 py-1.5 rounded font-mono text-xs font-bold tracking-wider transition-colors",
            criteriaReady && !isPending
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {isPending ? "SCANNING…" : "▶ RUN SCAN"}
        </button>

        <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
          <span>SORT BY</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-background border border-border rounded px-2 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
          >
            {CS_SORT_FIELDS.map(f => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          <select
            value={sortDir}
            onChange={e => setSortDir(e.target.value as "asc" | "desc")}
            className="bg-background border border-border rounded px-2 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
          >
            <option value="desc">↓ DESC</option>
            <option value="asc">↑ ASC</option>
          </select>
        </div>

        {ranOnce && !isPending && (
          <span className={cn(
            "text-xs font-mono",
            matchCount === 0 ? "text-muted-foreground" : "text-success"
          )}>
            {matchCount === undefined
              ? `${result?.results.length ?? 0} results`
              : `${matchCount} match${matchCount !== 1 ? "es" : ""} · showing top ${result?.results.length ?? 0}`
            }
          </span>
        )}

        {isError && (
          <span className="text-xs font-mono text-destructive">Scan failed — check criteria</span>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto min-h-0">
        {!ranOnce && !isPending && (
          <div className="flex items-center justify-center h-40 text-xs font-mono text-muted-foreground/50 border border-border/30 rounded-md">
            Configure filters above and press RUN SCAN
          </div>
        )}
        {(ranOnce || isPending) && (
          <ScannerTable
            response={result}
            isLoading={isPending}
          />
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Scanner() {
  const limit = 100;
  const [longSignal, setLongSignal] = useState<string>("longs");
  const [shortSignal, setShortSignal] = useState<string>("shorts");
  const qOpts = (qk: readonly unknown[]) => ({
    queryKey: qk,
    refetchInterval,
    staleTime: 29 * 60 * 1000,  // treat server results as fresh for 29 min — avoids refetch on back-nav
    gcTime:    32 * 60 * 1000,  // keep in memory 2 min beyond stale window
  });

  const { data: longs,        isLoading: lLoading    } = useGetScannerTopLongs({ limit },    { query: qOpts(getGetScannerTopLongsQueryKey({ limit }))    });
  const { data: shorts,       isLoading: sLoading    } = useGetScannerTopShorts({ limit },   { query: qOpts(getGetScannerTopShortsQueryKey({ limit }))   });
  const { data: breakouts,    isLoading: bLoading    } = useGetScannerBreakouts({ limit },   { query: qOpts(getGetScannerBreakoutsQueryKey({ limit }))   });
  const { data: breakdowns,   isLoading: bdLoading   } = useGetScannerBreakdowns({ limit },  { query: qOpts(getGetScannerBreakdownsQueryKey({ limit }))  });
  const { data: gamma,        isLoading: gLoading    } = useGetScannerGammaSqueeze({ limit },{ query: qOpts(getGetScannerGammaSqueezeQueryKey({ limit })) });
  const { data: ss,           isLoading: ssLoading   } = useGetScannerShortSqueeze({ limit },{ query: qOpts(getGetScannerShortSqueezeQueryKey({ limit })) });
  const { data: inst,         isLoading: instLoading } = useGetScannerInstitutionalAccumulation({ limit }, { query: qOpts(getGetScannerInstitutionalAccumulationQueryKey({ limit })) });
  const { data: mean,         isLoading: meanLoading } = useGetScannerMeanReversion({ limit },{ query: qOpts(getGetScannerMeanReversionQueryKey({ limit })) });
  const { data: gapSetupLong, isLoading: gslLoading  } = useGetScannerGapSetupLong({ limit }, { query: qOpts(getGetScannerGapSetupLongQueryKey({ limit })) });
  const { data: gapSetupShort,isLoading: gssLoading  } = useGetScannerGapSetupShort({ limit },{ query: qOpts(getGetScannerGapSetupShortQueryKey({ limit })) });
  const { data: gapUp,        isLoading: guLoading   } = useGetScannerGapUp({ limit },       { query: qOpts(getGetScannerGapUpQueryKey({ limit }))       });
  const { data: gapDown,      isLoading: gdLoading   } = useGetScannerGapDown({ limit },     { query: qOpts(getGetScannerGapDownQueryKey({ limit }))     });
  const { data: keyLevels,    isLoading: klLoading   } = useGetScannerKeyLevels({ limit },   { query: qOpts(getGetScannerKeyLevelsQueryKey({ limit }))   });
  const { data: reversalShort,isLoading: rsLoading   } = useGetScannerReversalShort({ limit },{ query: qOpts(getGetScannerReversalShortQueryKey({ limit })) });

  // Derive overall scan progress from the active-tab response (all tabs share the same job)
  const anyResponse = longs ?? shorts ?? breakouts ?? breakdowns ?? gapSetupLong ?? gapSetupShort ?? gapUp ?? gapDown ?? gamma ?? ss ?? inst ?? mean ?? keyLevels ?? reversalShort;
  const scanComplete = anyResponse?.complete ?? false;

  return (
    <div className="flex-1 p-6 overflow-hidden flex flex-col h-full">
      <div className="mb-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-display tracking-widest text-primary">MARKET SCANNER</h1>
          {!scanComplete && anyResponse && (
            <span className="text-xs font-mono text-muted-foreground animate-pulse">
              {anyResponse.progress.done} / {anyResponse.progress.total} analyzed
            </span>
          )}
          {scanComplete && (
            <span className="text-xs font-mono text-success flex items-center gap-1.5">
              ✓ {anyResponse?.progress.total} tickers scanned
              {(anyResponse as any)?.scannedAt && (() => {
                const ageMs  = Date.now() - (anyResponse as any).scannedAt;
                const ageMin = Math.floor(ageMs / 60000);
                const ttlMin = Math.max(0, 30 - ageMin);
                return (
                  <span className="text-muted-foreground/60">
                    · {ageMin === 0 ? "just now" : `${ageMin}m ago`} · refreshes in {ttlMin}m
                  </span>
                );
              })()}
            </span>
          )}
        </div>
        <p className="text-muted-foreground font-mono text-sm mt-1">
          Real-time institutional signal detection and pattern recognition.
        </p>
      </div>

      <Tabs defaultValue="longs-group" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start h-auto p-1 gap-1">
          <TabsTrigger value="longs-group"  className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">▲ LONG IDEAS</TabsTrigger>
          <TabsTrigger value="shorts-group" className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">▼ SHORT IDEAS</TabsTrigger>
          <TabsTrigger value="key-levels"   className="font-mono text-xs data-[state=active]:bg-cyan-700 data-[state=active]:text-white">KEY LEVELS</TabsTrigger>
          <TabsTrigger value="custom"       className="font-mono text-xs data-[state=active]:bg-violet-700 data-[state=active]:text-white">✦ CUSTOM SCAN</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto mt-4">

          {/* ── LONG IDEAS ──────────────────────────────────────────────────── */}
          <TabsContent value="longs-group" className="m-0 h-full flex flex-col">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/20 flex-wrap shrink-0">
              {([["longs","HIGH PROB"],["breakouts","BREAKOUTS"],["gap-setup-long","GAP SETUP ↑"],["gap-up","GAP UP ↑"],["inst","INST ACCUM"],["ss","SQUEEZE"],["mean","MEAN REV"]] as [string,string][]).map(([key,label]) => (
                <button key={key} onClick={() => setLongSignal(key)} className={cn(
                  "px-2.5 py-0.5 text-[11px] font-mono font-bold rounded transition-colors",
                  longSignal === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}>{label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {longSignal === "longs"          && <ScannerTable response={longs}        isLoading={lLoading}    autoFetch />}
              {longSignal === "breakouts"      && <ScannerTable response={breakouts}     isLoading={bLoading}    />}
              {longSignal === "gap-setup-long" && (
                <div className="flex flex-col h-full">
                  <div className="border-b border-warning/30 bg-warning/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
                    <span className="text-warning font-bold mr-2">GAP SETUP — LONG</span>
                    Stocks primed to gap UP · ATR ≥ 3.2% · BB Width ≥ 15% · RVOL ≥ 1.2× · RSI &lt; 70 · sorted by ATR% × RVOL.{" "}
                    <Link href="/backtest" className="text-warning/80 hover:text-warning underline decoration-dotted underline-offset-2">→ Gap Factor Research</Link>
                  </div>
                  <ScannerTable response={gapSetupLong} isLoading={gslLoading} showGapScore />
                </div>
              )}
              {longSignal === "gap-up"  && <ScannerTable response={gapUp}  isLoading={guLoading}   showGap />}
              {longSignal === "inst"    && <ScannerTable response={inst}    isLoading={instLoading} />}
              {longSignal === "ss"      && <ScannerTable response={ss}      isLoading={ssLoading}   />}
              {longSignal === "mean"    && <ScannerTable response={mean}    isLoading={meanLoading} />}
            </div>
          </TabsContent>

          {/* ── SHORT IDEAS ─────────────────────────────────────────────────── */}
          <TabsContent value="shorts-group" className="m-0 h-full flex flex-col">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/20 flex-wrap shrink-0">
              {([["shorts","HIGH PROB"],["breakdowns","BREAKDOWNS"],["gap-setup-short","GAP SETUP ↓"],["gap-down","GAP DOWN ↓"],["gamma","GAMMA SQUEEZE"],["reversal","⚠ REVERSAL"]] as [string,string][]).map(([key,label]) => (
                <button key={key} onClick={() => setShortSignal(key)} className={cn(
                  "px-2.5 py-0.5 text-[11px] font-mono font-bold rounded transition-colors",
                  shortSignal === key ? "bg-destructive text-destructive-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}>{label}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {shortSignal === "shorts"          && <ScannerTable response={shorts}      isLoading={sLoading}    autoFetch />}
              {shortSignal === "breakdowns"      && <ScannerTable response={breakdowns}   isLoading={bdLoading}   />}
              {shortSignal === "gap-setup-short" && (
                <div className="flex flex-col h-full">
                  <div className="border-b border-warning/30 bg-warning/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
                    <span className="text-warning font-bold mr-2">GAP SETUP — SHORT</span>
                    Stocks primed to gap DOWN · extended above SMA200 is the strongest predictor (+0.64σ) · ATR ≥ 3.2% · BB ≥ 15% · RVOL ≥ 1.2×.{" "}
                    <Link href="/backtest" className="text-warning/80 hover:text-warning underline decoration-dotted underline-offset-2">→ Gap Factor Research</Link>
                  </div>
                  <ScannerTable response={gapSetupShort} isLoading={gssLoading} showGapScore />
                </div>
              )}
              {shortSignal === "gap-down" && <ScannerTable response={gapDown}      isLoading={gdLoading}   showGap />}
              {shortSignal === "gamma"    && <ScannerTable response={gamma}        isLoading={gLoading}    />}
              {shortSignal === "reversal" && (
                <div className="flex flex-col h-full">
                  <div className="border-b border-rose-700/30 bg-rose-700/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
                    <span className="text-rose-400 font-bold mr-2">⚠ REVERSAL SHORT DETECTION</span>
                    Tops forming <span className="text-foreground">before</span> the Atlas Score flips. Signals: Double Top · Distribution · H&amp;S · Parabolic Rise · RSI divergence · BB extension.
                    Tiers: <span className="text-warning">FORMING ≥45</span> · <span className="text-rose-400">CONFIRMED ≥60</span> · <span className="text-destructive font-bold">EXTENDED ≥78</span>.
                  </div>
                  <ReversalShortTable response={reversalShort} isLoading={rsLoading} />
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── KEY LEVELS ──────────────────────────────────────────────────── */}
          <TabsContent value="key-levels" className="m-0 h-full flex flex-col gap-3">
            <div className="border border-cyan-700/30 rounded-md bg-cyan-700/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
              <span className="text-cyan-400 font-bold mr-2">KEY S/R LEVELS</span>
              Stocks within <span className="text-foreground">2%</span> of SMA50 · SMA200 · BB± · 20-day swing high/low — sorted closest first.
              DIST% column: <span className="text-warning">amber ≤ 0.5%</span> · <span className="text-primary">blue ≤ 1%</span>.
            </div>
            <ScannerTable response={keyLevels} isLoading={klLoading} showKeyLevel />
          </TabsContent>

          {/* ── CUSTOM SCAN ─────────────────────────────────────────────────── */}
          <TabsContent value="custom" className="m-0 h-full flex flex-col gap-4">
            <div className="border border-violet-700/30 rounded-md bg-violet-700/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
              <span className="text-violet-400 font-bold mr-2">✦ CUSTOM SCAN</span>
              Stack any combination of filters across all 590 tickers — score, RSI, RVOL, ATR%, direction, patterns, and more.
              All criteria are <span className="text-foreground">ANDed</span> together. Use presets to get started quickly.
            </div>
            <CustomScanTab />
          </TabsContent>

        </div>
      </Tabs>
    </div>
  );
}
