import React, { useState } from "react";
import { 
  useGetWatchlist, getGetWatchlistQueryKey,
  useAddToWatchlist,
  useRemoveFromWatchlist
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent, getBgColorForScore, getColorForDirection } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { Link } from "wouter";

export default function Watchlist() {
  const [ticker, setTicker] = useState("");
  const queryClient = useQueryClient();
  
  const { data: watchlist, isLoading } = useGetWatchlist({
    query: { queryKey: getGetWatchlistQueryKey() }
  });
  
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    
    addMutation.mutate(
      { data: { ticker: ticker.toUpperCase() } },
      {
        onSuccess: () => {
          setTicker("");
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        }
      }
    );
  };

  const handleRemove = (tickerToRemove: string) => {
    removeMutation.mutate(
      { ticker: tickerToRemove },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        }
      }
    );
  };

  return (
    <div className="flex-1 p-6 overflow-hidden flex flex-col h-full max-w-5xl mx-auto w-full">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-display tracking-widest text-primary mb-2">WATCHLIST MANAGEMENT</h1>
          <p className="text-muted-foreground font-mono text-sm">Monitor active targets and score changes.</p>
        </div>
        
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input 
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="TICKER"
            className="w-32 font-mono uppercase bg-card border-border"
          />
          <Button type="submit" disabled={addMutation.isPending} className="font-mono">
            <Plus className="w-4 h-4 mr-2" /> ADD
          </Button>
        </form>
      </div>

      <div className="flex-1 overflow-auto border border-border rounded-md bg-card">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground font-mono animate-pulse">LOADING WATCHLIST...</div>
        ) : !watchlist || watchlist.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono">WATCHLIST IS EMPTY</div>
        ) : (
          <table className="w-full text-sm font-mono text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border sticky top-0 z-10">
              <tr>
                <th className="p-4 font-medium">TICKER</th>
                <th className="p-4 font-medium text-right">PRICE</th>
                <th className="p-4 font-medium text-right">CHG %</th>
                <th className="p-4 font-medium text-center">ATLAS</th>
                <th className="p-4 font-medium">DIRECTION</th>
                <th className="p-4 font-medium text-right">CONF</th>
                <th className="p-4 font-medium text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {watchlist.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4 font-bold text-primary">
                    <Link href={`/?ticker=${item.ticker}`} className="hover:underline">{item.ticker}</Link>
                  </td>
                  <td className="p-4 text-right">{formatCurrency(item.price)}</td>
                  <td className={cn("p-4 text-right", item.change && item.change >= 0 ? "text-success" : "text-destructive")}>
                    {item.change && item.change >= 0 ? "+" : ""}{formatPercent(item.changePercent)}
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center">
                      <div className={cn("px-2 py-0.5 rounded text-xs font-bold w-12 text-center", getBgColorForScore(item.atlasScore || 0), "text-background")}>
                        {item.atlasScore?.toFixed(0) || '-'}
                      </div>
                    </div>
                  </td>
                  <td className={cn("p-4 font-bold uppercase", getColorForDirection(item.direction))}>
                    {item.direction || '-'}
                  </td>
                  <td className="p-4 text-right">{formatPercent(item.bullishProbability)}</td>
                  <td className="p-4 text-right">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleRemove(item.ticker)}
                      className="text-muted-foreground hover:text-destructive h-8 px-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
