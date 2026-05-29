import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  useGetScannerTopLongs, getGetScannerTopLongsQueryKey,
  useGetScannerTopShorts, getGetScannerTopShortsQueryKey,
  useGetScannerBreakouts, getGetScannerBreakoutsQueryKey,
  useGetScannerBreakdowns, getGetScannerBreakdownsQueryKey,
  useGetScannerGammaSqueeze, getGetScannerGammaSqueezeQueryKey,
  useGetScannerShortSqueeze, getGetScannerShortSqueezeQueryKey,
  useGetScannerInstitutionalAccumulation, getGetScannerInstitutionalAccumulationQueryKey,
  useGetScannerMeanReversion, getGetScannerMeanReversionQueryKey,
  useGetScannerGapUp, getGetScannerGapUpQueryKey,
  useGetScannerGapDown, getGetScannerGapDownQueryKey,
  ScannerResult
} from "@workspace/api-client-react";
import { formatCurrency, formatPercent, getBgColorForScore, getColorForDirection } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

function ScannerTable({ data, isLoading, showGap }: { data?: ScannerResult[], isLoading: boolean, showGap?: boolean }) {
  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground font-mono animate-pulse">SCANNING MARKET...</div>;
  }

  if (!data || data.length === 0) {
    return <div className="p-8 text-center text-muted-foreground font-mono">NO RESULTS FOUND FOR CURRENT CRITERIA</div>;
  }

  return (
    <div className="overflow-auto border border-border rounded-md bg-card">
      <table className="w-full text-sm font-mono text-left">
        <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0 z-10">
          <tr>
            <th className="px-3 py-2 w-20">TICKER</th>
            <th className="px-3 py-2">NAME</th>
            <th className="px-3 py-2 text-right w-20">PRICE</th>
            <th className="px-3 py-2 text-right w-20">CHG%</th>
            {showGap && <th className="px-3 py-2 text-right w-20">GAP%</th>}
            <th className="px-3 py-2 text-right w-20">SCORE</th>
            <th className="px-3 py-2 text-right w-16">RSI</th>
            <th className="px-3 py-2 text-right w-16">RVOL</th>
            <th className="px-3 py-2 w-32">CATALYSTS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr key={row.ticker} className="hover:bg-muted/30 transition-colors cursor-pointer">
              <td className="px-3 py-2">
                <Link href={`/?ticker=${row.ticker}`} className="text-primary font-bold hover:underline">
                  {row.ticker}
                </Link>
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
              <td className={cn("px-3 py-2 text-right", row.rsi > 70 ? "text-destructive" : row.rsi < 30 ? "text-success" : "text-foreground")}>
                {row.rsi.toFixed(1)}
              </td>
              <td className={cn("px-3 py-2 text-right", row.relativeVolume > 2 ? "text-warning" : "text-foreground")}>
                {row.relativeVolume.toFixed(1)}x
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {row.catalysts.slice(0, 2).map((c, i) => (
                    <span key={i} className="text-xs text-muted-foreground bg-muted px-1 rounded">{c}</span>
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

export default function Scanner() {
  const limit = 25;
  const { data: longs, isLoading: lLoading } = useGetScannerTopLongs({ limit }, { query: { queryKey: getGetScannerTopLongsQueryKey({ limit }) }});
  const { data: shorts, isLoading: sLoading } = useGetScannerTopShorts({ limit }, { query: { queryKey: getGetScannerTopShortsQueryKey({ limit }) }});
  const { data: breakouts, isLoading: bLoading } = useGetScannerBreakouts({ limit }, { query: { queryKey: getGetScannerBreakoutsQueryKey({ limit }) }});
  const { data: breakdowns, isLoading: bdLoading } = useGetScannerBreakdowns({ limit }, { query: { queryKey: getGetScannerBreakdownsQueryKey({ limit }) }});
  const { data: gamma, isLoading: gLoading } = useGetScannerGammaSqueeze({ limit }, { query: { queryKey: getGetScannerGammaSqueezeQueryKey({ limit }) }});
  const { data: ss, isLoading: ssLoading } = useGetScannerShortSqueeze({ limit }, { query: { queryKey: getGetScannerShortSqueezeQueryKey({ limit }) }});
  const { data: inst, isLoading: instLoading } = useGetScannerInstitutionalAccumulation({ limit }, { query: { queryKey: getGetScannerInstitutionalAccumulationQueryKey({ limit }) }});
  const { data: mean, isLoading: meanLoading } = useGetScannerMeanReversion({ limit }, { query: { queryKey: getGetScannerMeanReversionQueryKey({ limit }) }});
  const { data: gapUp, isLoading: guLoading } = useGetScannerGapUp({ limit }, { query: { queryKey: getGetScannerGapUpQueryKey({ limit }) }});
  const { data: gapDown, isLoading: gdLoading } = useGetScannerGapDown({ limit }, { query: { queryKey: getGetScannerGapDownQueryKey({ limit }) }});

  return (
    <div className="flex-1 p-6 overflow-hidden flex flex-col h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-display tracking-widest text-primary mb-2">MARKET SCANNER</h1>
        <p className="text-muted-foreground font-mono text-sm">Real-time institutional signal detection and pattern recognition.</p>
      </div>

      <Tabs defaultValue="longs" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start h-auto flex-wrap p-1 gap-1">
          <TabsTrigger value="longs" className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">HIGH PROB LONGS</TabsTrigger>
          <TabsTrigger value="shorts" className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">HIGH PROB SHORTS</TabsTrigger>
          <TabsTrigger value="breakouts" className="font-mono text-xs data-[state=active]:bg-success data-[state=active]:text-success-foreground">BREAKOUTS</TabsTrigger>
          <TabsTrigger value="breakdowns" className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">BREAKDOWNS</TabsTrigger>
          <TabsTrigger value="gap-up" className="font-mono text-xs data-[state=active]:bg-success data-[state=active]:text-success-foreground">GAP UP ↑</TabsTrigger>
          <TabsTrigger value="gap-down" className="font-mono text-xs data-[state=active]:bg-destructive data-[state=active]:text-destructive-foreground">GAP DOWN ↓</TabsTrigger>
          <TabsTrigger value="gamma" className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">GAMMA SQUEEZE</TabsTrigger>
          <TabsTrigger value="ss" className="font-mono text-xs data-[state=active]:bg-warning data-[state=active]:text-warning-foreground">SHORT SQUEEZE</TabsTrigger>
          <TabsTrigger value="inst" className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">INST ACCUM</TabsTrigger>
          <TabsTrigger value="mean" className="font-mono text-xs data-[state=active]:bg-muted-foreground data-[state=active]:text-background">MEAN REVERSION</TabsTrigger>
        </TabsList>
        
        <div className="flex-1 overflow-auto mt-4">
          <TabsContent value="longs" className="m-0 h-full"><ScannerTable data={longs} isLoading={lLoading} /></TabsContent>
          <TabsContent value="shorts" className="m-0 h-full"><ScannerTable data={shorts} isLoading={sLoading} /></TabsContent>
          <TabsContent value="breakouts" className="m-0 h-full"><ScannerTable data={breakouts} isLoading={bLoading} /></TabsContent>
          <TabsContent value="breakdowns" className="m-0 h-full"><ScannerTable data={breakdowns} isLoading={bdLoading} /></TabsContent>
          <TabsContent value="gap-up" className="m-0 h-full"><ScannerTable data={gapUp} isLoading={guLoading} showGap /></TabsContent>
          <TabsContent value="gap-down" className="m-0 h-full"><ScannerTable data={gapDown} isLoading={gdLoading} showGap /></TabsContent>
          <TabsContent value="gamma" className="m-0 h-full"><ScannerTable data={gamma} isLoading={gLoading} /></TabsContent>
          <TabsContent value="ss" className="m-0 h-full"><ScannerTable data={ss} isLoading={ssLoading} /></TabsContent>
          <TabsContent value="inst" className="m-0 h-full"><ScannerTable data={inst} isLoading={instLoading} /></TabsContent>
          <TabsContent value="mean" className="m-0 h-full"><ScannerTable data={mean} isLoading={meanLoading} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
