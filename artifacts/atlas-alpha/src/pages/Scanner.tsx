import React, { useState, useCallback, useRef, useMemo } from "react";
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
  type ScannerResponse,
  type ScannerResult,
} from "@workspace/api-client-react";
import { formatCurrency, formatPercent, getBgColorForScore } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronUp, ChevronDown, ChevronsUpDown, FlaskConical, RotateCcw } from "lucide-react";

type SortCol =
  | "ticker" | "name" | "price" | "changePercent" | "gapPercent"
  | "atlasScore" | "rsi" | "relativeVolume" | "gapSetupScore" | "keyLevelDist"
  | "rankIC";
type SortDir = "asc" | "desc";

/** Polling interval while scan is in progress */
const POLL_MS = 2000;

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
}: {
  response?: ScannerResponse;
  isLoading: boolean;
  showGap?: boolean;
  showGapScore?: boolean;
  showKeyLevel?: boolean;
}) {
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Backtest state ──────────────────────────────────────────────────────────
  const [icMap, setIcMap]     = useState<Map<string, IcEntry>>(new Map());
  const [btLoading, setBtLoading] = useState(false);
  const [btDone, setBtDone]   = useState(0);
  const [btTotal, setBtTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

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

  // ── Sort ────────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortCol === "rankIC") {
        av = icMap.get(a.ticker)?.rankIC ?? -Infinity;
        bv = icMap.get(b.ticker)?.rankIC ?? -Infinity;
      } else {
        av = a[sortCol] ?? "";
        bv = b[sortCol] ?? "";
      }
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir, icMap]);

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
    <div className="overflow-auto border border-border rounded-md bg-card flex flex-col">
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

      {/* Distorted ETF disclaimer — shown when leveraged/volatility ETFs appear in results */}
      {hasDistorted && (
        <div className="px-4 py-2 border-b border-warning/20 bg-warning/5 text-[10px] font-mono text-warning/80 flex items-center gap-2">
          <span className="font-bold text-warning shrink-0">⚠ LEV/VIX PRODUCTS</span>
          <span>Results include leveraged or VIX-futures ETFs (marked LEV/VIX). These have structural daily-reset decay — Atlas Alpha scores reflect short-term momentum only. Not suitable for multi-day holds.</span>
        </div>
      )}

      {data.length === 0 && complete ? (
        <div className="p-8 text-center text-muted-foreground font-mono text-sm">
          NO RESULTS FOUND FOR CURRENT CRITERIA
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
              <SortableTh col="rankIC"         label="IC 5D"  className="text-right w-20"  {...thProps} />
              <th className="px-3 py-2 w-36">LEVELS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map(row => {
              const ic = icMap.get(row.ticker);
              return (
                <tr key={row.ticker} className="hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/?ticker=${row.ticker}`} className="text-primary font-bold hover:underline">
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

                  {/* ── IC 10D column ───────────────────────────────────────── */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {ic ? (
                      <span className={cn("font-bold text-xs", icColor(ic.rankICRating))}>
                        {ic.rankIC >= 0 ? "+" : ""}{ic.rankIC.toFixed(3)}
                        <span className="text-muted-foreground/40 font-normal ml-0.5 text-[10px]">
                          t{ic.icTStat >= 0 ? "+" : ""}{ic.icTStat.toFixed(1)}
                        </span>
                      </span>
                    ) : (
                      btLoading
                        ? <span className="text-muted-foreground/30 animate-pulse">…</span>
                        : <span className="text-muted-foreground/30">—</span>
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Scanner() {
  const limit = 25;
  const qOpts = (qk: readonly unknown[]) => ({
    queryKey: qk,
    refetchInterval,
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

  // Derive overall scan progress from the active-tab response (all tabs share the same job)
  const anyResponse = longs ?? shorts ?? breakouts ?? breakdowns ?? gapSetupLong ?? gapSetupShort ?? gapUp ?? gapDown ?? gamma ?? ss ?? inst ?? mean ?? keyLevels;
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
            <span className="text-xs font-mono text-success">
              ✓ {anyResponse?.progress.total} tickers scanned
            </span>
          )}
        </div>
        <p className="text-muted-foreground font-mono text-sm mt-1">
          Real-time institutional signal detection and pattern recognition.
        </p>
      </div>

      <Tabs defaultValue="longs" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start h-auto flex-wrap p-1 gap-1">
          <TabsTrigger value="longs"      className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">HIGH PROB LONGS</TabsTrigger>
          <TabsTrigger value="shorts"     className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">HIGH PROB SHORTS</TabsTrigger>
          <TabsTrigger value="breakouts"  className="font-mono text-xs data-[state=active]:bg-success data-[state=active]:text-success-foreground">BREAKOUTS</TabsTrigger>
          <TabsTrigger value="breakdowns" className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">BREAKDOWNS</TabsTrigger>
          <TabsTrigger value="gap-setup-long"  className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">GAP SETUP ↑</TabsTrigger>
          <TabsTrigger value="gap-setup-short" className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">GAP SETUP ↓</TabsTrigger>
          <TabsTrigger value="gap-up"     className="font-mono text-xs data-[state=active]:bg-success data-[state=active]:text-success-foreground">GAP UP ↑</TabsTrigger>
          <TabsTrigger value="gap-down"   className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">GAP DOWN ↓</TabsTrigger>
          <TabsTrigger value="gamma"      className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">GAMMA SQUEEZE</TabsTrigger>
          <TabsTrigger value="ss"         className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">SHORT SQUEEZE</TabsTrigger>
          <TabsTrigger value="inst"       className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">INST ACCUM</TabsTrigger>
          <TabsTrigger value="mean"       className="font-mono text-xs data-[state=active]:bg-muted-foreground data-[state=active]:text-background">MEAN REVERSION</TabsTrigger>
          <TabsTrigger value="key-levels" className="font-mono text-xs data-[state=active]:bg-cyan-700 data-[state=active]:text-white">KEY LEVELS</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto mt-4">
          <TabsContent value="longs"      className="m-0 h-full"><ScannerTable response={longs}      isLoading={lLoading}    /></TabsContent>
          <TabsContent value="shorts"     className="m-0 h-full"><ScannerTable response={shorts}     isLoading={sLoading}    /></TabsContent>
          <TabsContent value="breakouts"  className="m-0 h-full"><ScannerTable response={breakouts}  isLoading={bLoading}    /></TabsContent>
          <TabsContent value="breakdowns" className="m-0 h-full"><ScannerTable response={breakdowns} isLoading={bdLoading}   /></TabsContent>
          <TabsContent value="gap-setup-long" className="m-0 h-full flex flex-col gap-3">
            <div className="border border-warning/30 rounded-md bg-warning/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
              <span className="text-warning font-bold mr-2">GAP SETUP — LONG</span>
              Stocks primed to gap UP based on research from 771 historical gaps.
              Filter: <span className="text-foreground">ATR ≥ 3.2%</span> · <span className="text-foreground">BB Width ≥ 15%</span> · <span className="text-foreground">RVOL ≥ 1.2×</span> · RSI &lt; 70 · not already gapping · direction not bearish.
              Sorted by <span className="text-foreground">ATR% × RVOL</span> (most volatility-primed first). Check RVOL column — elevated volume is the second-strongest predictor.
            </div>
            <ScannerTable response={gapSetupLong} isLoading={gslLoading} showGapScore />
          </TabsContent>
          <TabsContent value="gap-setup-short" className="m-0 h-full flex flex-col gap-3">
            <div className="border border-warning/30 rounded-md bg-warning/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
              <span className="text-warning font-bold mr-2">GAP SETUP — SHORT</span>
              Stocks primed to gap DOWN based on research from 771 historical gaps.
              Filter: <span className="text-foreground">ATR ≥ 3.2%</span> · <span className="text-foreground">BB Width ≥ 15%</span> · <span className="text-foreground">RVOL ≥ 1.2×</span> · <span className="text-foreground">SMA200 extended &gt; 5%</span> · not already gapping · direction not bullish.
              Extended-above-SMA200 is the <span className="text-foreground">strongest directional predictor</span> (+0.64σ) for gap-downs. Sorted by SMA200 extension × ATR.
            </div>
            <ScannerTable response={gapSetupShort} isLoading={gssLoading} showGapScore />
          </TabsContent>
          <TabsContent value="gap-up"     className="m-0 h-full"><ScannerTable response={gapUp}      isLoading={guLoading}   showGap /></TabsContent>
          <TabsContent value="gap-down"   className="m-0 h-full"><ScannerTable response={gapDown}    isLoading={gdLoading}   showGap /></TabsContent>
          <TabsContent value="gamma"      className="m-0 h-full"><ScannerTable response={gamma}      isLoading={gLoading}    /></TabsContent>
          <TabsContent value="ss"         className="m-0 h-full"><ScannerTable response={ss}         isLoading={ssLoading}   /></TabsContent>
          <TabsContent value="inst"       className="m-0 h-full"><ScannerTable response={inst}       isLoading={instLoading} /></TabsContent>
          <TabsContent value="mean"       className="m-0 h-full"><ScannerTable response={mean}       isLoading={meanLoading} /></TabsContent>
          <TabsContent value="key-levels" className="m-0 h-full flex flex-col gap-3">
            <div className="border border-cyan-700/30 rounded-md bg-cyan-700/5 px-4 py-2.5 text-xs font-mono text-muted-foreground leading-relaxed shrink-0">
              <span className="text-cyan-400 font-bold mr-2">KEY S/R LEVELS</span>
              Stocks within <span className="text-foreground">2%</span> of a major support or resistance level — sorted closest first.
              Levels checked: <span className="text-foreground">SMA50</span> · <span className="text-foreground">SMA200</span> · <span className="text-foreground">BB+ (upper band)</span> · <span className="text-foreground">BB− (lower band)</span> · <span className="text-foreground">20-day swing high/low</span>.
              DIST% column shows distance to the nearest level — <span className="text-warning">amber ≤ 0.5%</span>, <span className="text-primary">blue ≤ 1%</span>.
            </div>
            <ScannerTable response={keyLevels} isLoading={klLoading} showKeyLevel />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
