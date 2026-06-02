import React, { useState } from "react";
import { useGetWatchlist, useAddToWatchlist, useRemoveFromWatchlist, getGetWatchlistQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { formatCurrency, formatPercent, getColorForDirection } from "@/lib/formatters";
import { X, ExternalLink, Plus } from "lucide-react";

export default function WatchlistSidebar() {
  const queryClient = useQueryClient();
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState("");

  const { data: watchlist, isLoading } = useGetWatchlist({
    query: { queryKey: getGetWatchlistQueryKey() }
  });
  const addMutation    = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ticker = addInput.trim().toUpperCase();
    if (!ticker) return;
    setAddError("");
    addMutation.mutate(
      { data: { ticker } },
      {
        onSuccess: () => {
          setAddInput("");
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        },
        onError: () => {
          setAddError("Invalid ticker");
        },
      }
    );
  };

  const handleRemove = (ticker: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    removeMutation.mutate(
      { ticker },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-3 border-b border-border bg-muted/30">
        <h2 className="text-sm font-bold tracking-wider text-muted-foreground">WATCHLIST</h2>
      </div>

      {/* Add ticker input */}
      <form onSubmit={handleAdd} className="p-2 border-b border-border flex gap-1">
        <input
          type="text"
          value={addInput}
          onChange={e => { setAddInput(e.target.value.toUpperCase()); setAddError(""); }}
          placeholder="Add ticker…"
          maxLength={10}
          className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs font-mono uppercase placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={!addInput.trim() || addMutation.isPending}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-40 transition-colors"
          title="Add to watchlist"
        >
          <Plus className="w-3 h-3" />
        </button>
      </form>
      {addError && (
        <div className="px-2 py-1 text-[10px] text-destructive font-mono">{addError}</div>
      )}

      {/* Watchlist items */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse flex justify-between">
                <div className="h-4 w-12 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : !watchlist?.length ? (
          <div className="p-4 text-sm text-muted-foreground text-center">Watchlist empty.</div>
        ) : (
          <div className="divide-y divide-border">
            {watchlist.map(item => (
              <Link key={item.id} href={`/?ticker=${item.ticker}`} className="block hover:bg-muted/50 transition-colors p-3 outline-none">
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
                    <span className={getColorForDirection(item.direction)}>{item.atlasScore?.toFixed(0) || "-"}</span>
                    <span className="text-muted-foreground">ATLAS</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="p-2 border-t border-border space-y-1">
        <Link href="/scanner" className="flex justify-between items-center px-2 py-1.5 text-xs font-mono font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md">
          SCANNER
          <ExternalLink className="w-3 h-3 opacity-50" />
        </Link>
        <Link href="/watchlist" className="flex justify-between items-center px-2 py-1.5 text-xs font-mono font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md">
          CSV IMPORT / MANAGE
          <ExternalLink className="w-3 h-3 opacity-50" />
        </Link>
      </div>
    </div>
  );
}
