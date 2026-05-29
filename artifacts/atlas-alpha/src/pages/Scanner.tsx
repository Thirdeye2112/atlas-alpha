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
  ScannerResult
} from "@workspace/api-client-react";
import { formatCurrency, formatPercent, getBgColorForScore, getColorForDirection } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

function ScannerTable({ data, isLoading }: { data?: ScannerResult[], isLoading: boolean }) {
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
            <th className="p-3 font-medium">TICKER</th>
            <th className="p-3 font-medium text-right">PRICE</th>
            <th className="p-3 font-medium text-right">CHG %</th>
            <th className="p-3 font-medium text-center">ATLAS</th>
            <th className="p-3 font-medium">DIRECTION</th>
            <th className="p-3 font-medium text-right">CONF</th>
            <th className="p-3 font-medium text-right">RSI</th>
            <th className="p-3 font-medium text-right">RVOL</th>
            <th className="p-3 font-medium hidden md:table-cell">SECTOR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.map((row) => (
            <tr key={row.ticker} className="hover:bg-muted/30 transition-colors group">
              <td className="p-3 font-bold text-primary">
                <Link href={`/?ticker=${row.ticker}`} className="hover:underline">{row.ticker}</Link>
              </td>
              <td className="p-3 text-right">{formatCurrency(row.price)}</td>
              <td className={cn("p-3 text-right", row.change >= 0 ? "text-success" : "text-destructive")}>
                {row.change >= 0 ? "+" : ""}{formatPercent(row.changePercent)}
              </td>
              <td className="p-3">
                <div className="flex justify-center">
                  <div className={cn("px-2 py-0.5 rounded text-xs font-bold w-12 text-center", getBgColorForScore(row.atlasScore), "text-background")}>
                    {row.atlasScore.toFixed(0)}
                  </div>
                </div>
              </td>
              <td className={cn("p-3 font-bold uppercase", getColorForDirection(row.direction))}>
                {row.direction}
              </td>
              <td className="p-3 text-right">{formatPercent(row.confidenceScore)}</td>
              <td className="p-3 text-right">{row.rsi.toFixed(1)}</td>
              <td className={cn("p-3 text-right", row.relativeVolume > 2 ? "text-warning" : "")}>
                {row.relativeVolume.toFixed(2)}x
              </td>
              <td className="p-3 text-muted-foreground hidden md:table-cell truncate max-w-[150px]">
                {row.sector || '-'}
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
          <TabsContent value="gamma" className="m-0 h-full"><ScannerTable data={gamma} isLoading={gLoading} /></TabsContent>
          <TabsContent value="ss" className="m-0 h-full"><ScannerTable data={ss} isLoading={ssLoading} /></TabsContent>
          <TabsContent value="inst" className="m-0 h-full"><ScannerTable data={inst} isLoading={instLoading} /></TabsContent>
          <TabsContent value="mean" className="m-0 h-full"><ScannerTable data={mean} isLoading={meanLoading} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
