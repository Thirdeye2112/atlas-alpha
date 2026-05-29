import React, { useState } from "react";
import { useGetWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatCurrency, formatPercent, getColorForDirection } from "@/lib/formatters";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WatchlistSidebar() {
  const queryClient = useQueryClient();
  const { data: watchlist, isLoading } = useGetWatchlist({
    query: { queryKey: getGetWatchlistQueryKey() }
  });
  const removeMutation = useRemoveFromWatchlist();

  const handleRemove = (ticker: string, e: React.MouseEvent) => {
    e.preventDefault();
    removeMutation.mutate(
      { ticker },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        }
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-bold tracking-wider text-muted-foreground">WATCHLIST</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse flex justify-between">
                <div className="h-4 w-12 bg-muted rounded"></div>
                <div className="h-4 w-16 bg-muted rounded"></div>
              </div>
            ))}
          </div>
        ) : !watchlist?.length ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            Watchlist empty.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {watchlist.map(item => (
              <Link key={item.id} href={`/?ticker=${item.ticker}`} className="block hover:bg-muted/50 transition-colors p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-primary">{item.ticker}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{formatCurrency(item.price)}</span>
                    <button 
                      onClick={(e) => handleRemove(item.ticker, e)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className={item.change && item.change >= 0 ? "text-success" : "text-destructive"}>
                    {formatPercent(item.changePercent)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={getColorForDirection(item.direction)}>{item.atlasScore?.toFixed(0) || '-'}</span>
                    <span className="text-muted-foreground">ATLAS</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-y border-border bg-muted/30">
        <h2 className="text-sm font-bold tracking-wider text-muted-foreground">SCANNERS</h2>
      </div>
      <div className="p-2 space-y-1">
        {["Top Longs", "Top Shorts", "Breakouts", "Breakdowns", "Gamma Squeeze", "Short Squeeze", "Inst Accum"].map(scan => (
          <Link key={scan} href="/scanner" className="flex justify-between items-center px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md">
            {scan}
            <ExternalLink className="w-3 h-3 opacity-50" />
          </Link>
        ))}
      </div>
    </div>
  );
}
