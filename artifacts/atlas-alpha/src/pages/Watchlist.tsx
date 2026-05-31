import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  useGetWatchlist, getGetWatchlistQueryKey,
  useAddToWatchlist,
  useRemoveFromWatchlist
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent, getBgColorForScore, getColorForDirection } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Bell, BellOff, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

interface Alert {
  id: number;
  ticker: string;
  conditionType: string;
  threshold: number | null;
  lastKnownDir: string | null;
  isActive: boolean;
  lastTriggeredAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

async function fetchAlerts(): Promise<Alert[]> {
  const r = await fetch("/api/alerts");
  if (!r.ok) throw new Error("Failed to fetch alerts");
  return r.json();
}

async function fetchTriggered(): Promise<Alert[]> {
  const r = await fetch("/api/alerts/triggered");
  if (!r.ok) throw new Error("Failed to fetch triggered alerts");
  return r.json();
}

async function createAlert(body: { ticker: string; conditionType: string; threshold?: number }): Promise<Alert> {
  const r = await fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to create alert"); }
  return r.json();
}

async function deleteAlert(id: number): Promise<void> {
  await fetch(`/api/alerts/${id}`, { method: "DELETE" });
}

async function acknowledgeAlert(id: number): Promise<void> {
  await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
}

const CONDITION_LABELS: Record<string, string> = {
  score_above:     "Score ≥",
  score_below:     "Score ≤",
  direction_change: "Direction changes",
};

export default function Watchlist() {
  const [ticker, setTicker] = useState("");
  const [alertPanelTicker, setAlertPanelTicker] = useState<string | null>(null);
  const [newCondition, setNewCondition] = useState<"score_above" | "score_below" | "direction_change">("score_above");
  const [newThreshold, setNewThreshold] = useState("70");
  const qc = useQueryClient();

  const { data: watchlist, isLoading } = useGetWatchlist({
    query: { queryKey: getGetWatchlistQueryKey() }
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: fetchAlerts,
    staleTime: 30_000,
  });

  const { data: triggered = [] } = useQuery({
    queryKey: ["alerts-triggered"],
    queryFn: fetchTriggered,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();

  const createAlertMutation = useMutation({
    mutationFn: createAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: deleteAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const ackMutation = useMutation({
    mutationFn: acknowledgeAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["alerts-triggered"] });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return;
    addMutation.mutate(
      { data: { ticker: ticker.toUpperCase() } },
      { onSuccess: () => { setTicker(""); qc.invalidateQueries({ queryKey: getGetWatchlistQueryKey() }); } }
    );
  };

  const handleRemove = (t: string) => {
    removeMutation.mutate(
      { ticker: t },
      { onSuccess: () => qc.invalidateQueries({ queryKey: getGetWatchlistQueryKey() }) }
    );
  };

  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!alertPanelTicker) return;
    const body: Parameters<typeof createAlert>[0] = {
      ticker: alertPanelTicker,
      conditionType: newCondition,
    };
    if (newCondition !== "direction_change") body.threshold = Number(newThreshold);
    createAlertMutation.mutate(body, {
      onSuccess: () => setAlertPanelTicker(null),
    });
  };

  const tickerAlerts = (t: string) => alerts.filter(a => a.ticker === t);

  return (
    <div className="flex-1 p-6 overflow-hidden flex flex-col h-full max-w-5xl mx-auto w-full">

      {/* ── Triggered alert banner ────────────────────────────────────── */}
      {triggered.length > 0 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5" />
            {triggered.length} ALERT{triggered.length > 1 ? "S" : ""} TRIGGERED
          </div>
          {triggered.map(a => (
            <div key={a.id} className="flex items-center justify-between text-xs font-mono">
              <span className="text-amber-300">
                <span className="font-bold">{a.ticker}</span>
                {" — "}
                {CONDITION_LABELS[a.conditionType] ?? a.conditionType}
                {a.threshold !== null ? ` ${a.threshold}` : ""}
                {a.lastTriggeredAt ? ` (${new Date(a.lastTriggeredAt).toLocaleTimeString()})` : ""}
              </span>
              <button
                onClick={() => ackMutation.mutate(a.id)}
                className="flex items-center gap-1 px-2 py-0.5 border border-amber-500/30 rounded hover:bg-amber-500/10 text-amber-400"
              >
                <CheckCircle2 className="w-3 h-3" /> ACK
              </button>
            </div>
          ))}
        </div>
      )}

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
              {watchlist.map((item) => {
                const ta = tickerAlerts(item.ticker);
                const isPanelOpen = alertPanelTicker === item.ticker;
                return (
                  <React.Fragment key={item.id}>
                    <tr className="hover:bg-muted/30 transition-colors">
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
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setAlertPanelTicker(isPanelOpen ? null : item.ticker)}
                            className={cn(
                              "p-1.5 rounded hover:bg-muted/50 transition-colors relative",
                              isPanelOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Manage alerts"
                          >
                            <Bell className="w-4 h-4" />
                            {ta.length > 0 && (
                              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-amber-500 rounded-full text-[8px] flex items-center justify-center text-black font-bold">
                                {ta.length}
                              </span>
                            )}
                          </button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(item.ticker)}
                            className="text-muted-foreground hover:text-destructive h-8 px-2"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>

                    {/* ── Alert panel (inline, under this row) ── */}
                    {isPanelOpen && (
                      <tr>
                        <td colSpan={7} className="bg-card/80 border-t border-b border-primary/20">
                          <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                                ALERTS — {item.ticker}
                              </span>
                              <button onClick={() => setAlertPanelTicker(null)} className="text-muted-foreground hover:text-foreground">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Existing alerts */}
                            {ta.length > 0 ? (
                              <div className="space-y-1.5">
                                {ta.map(a => (
                                  <div key={a.id} className="flex items-center justify-between text-xs font-mono bg-muted/30 rounded px-3 py-1.5">
                                    <span className={cn(
                                      a.lastTriggeredAt && !a.acknowledgedAt ? "text-amber-400" : "text-muted-foreground"
                                    )}>
                                      {CONDITION_LABELS[a.conditionType] ?? a.conditionType}
                                      {a.threshold !== null ? ` ${a.threshold}` : ""}
                                      {a.lastTriggeredAt && !a.acknowledgedAt ? " 🔔 FIRED" : ""}
                                    </span>
                                    <button
                                      onClick={() => deleteAlertMutation.mutate(a.id)}
                                      className="text-muted-foreground hover:text-destructive"
                                    >
                                      <BellOff className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground font-mono">No alerts set for {item.ticker}.</p>
                            )}

                            {/* New alert form */}
                            <form onSubmit={handleCreateAlert} className="flex items-center gap-2 flex-wrap">
                              <select
                                value={newCondition}
                                onChange={e => setNewCondition(e.target.value as typeof newCondition)}
                                className="text-xs font-mono bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                              >
                                <option value="score_above">Score ≥</option>
                                <option value="score_below">Score ≤</option>
                                <option value="direction_change">Direction changes</option>
                              </select>
                              {newCondition !== "direction_change" && (
                                <input
                                  type="number"
                                  min={0} max={100}
                                  value={newThreshold}
                                  onChange={e => setNewThreshold(e.target.value)}
                                  className="w-16 text-xs font-mono bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                                />
                              )}
                              <button
                                type="submit"
                                disabled={createAlertMutation.isPending}
                                className="text-xs font-mono px-3 py-1 bg-primary/10 border border-primary/30 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                              >
                                + ADD ALERT
                              </button>
                              {createAlertMutation.isError && (
                                <span className="text-xs text-destructive font-mono">
                                  {(createAlertMutation.error as Error)?.message}
                                </span>
                              )}
                            </form>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
