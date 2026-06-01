import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  useGetWatchlist, getGetWatchlistQueryKey,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useUpdateWatchlistPosition,
  useRefreshWatchlistPrices,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent, getBgColorForScore, getColorForDirection } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Bell, BellOff, X, CheckCircle2, AlertTriangle, Upload, RefreshCw } from "lucide-react";
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
  score_above:      "Score ≥",
  score_below:      "Score ≤",
  direction_change: "Direction changes",
  price_above:      "Price ≥ $",
  price_below:      "Price ≤ $",
};

interface CsvPosition {
  ticker: string;
  description: string | null;
  quantity: number | null;
  costBasisTotal: number | null;
  avgCostBasis: number | null;
  accountName: string | null;
  todayGainLossDollar: number | null;
  todayGainLossPercent: number | null;
  totalGainLossDollar: number | null;
  totalGainLossPercent: number | null;
  percentOfAccount: number | null;
}

function parseCsvPositions(text: string): CsvPosition[] {
  // Strip UTF-8 BOM if present
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());

  const findCol = (...names: string[]): number =>
    names.reduce<number>((found, name) => found >= 0 ? found : header.indexOf(name), -1);

  const symbolIdx    = findCol("symbol", "ticker", "stock symbol", "security");
  if (symbolIdx < 0) return [];

  const qtyIdx          = findCol("quantity", "qty", "shares");
  const costTotalIdx    = findCol("cost basis total", "cost basis", "total cost basis", "total cost");
  const avgCostIdx      = findCol("average cost basis", "avg cost basis per share", "avg cost basis", "avg cost", "average cost");
  const accountIdx      = findCol("account name", "account");
  const descriptionIdx  = findCol("description", "security name", "name");
  const todayDollarIdx  = findCol("today's gain/loss dollar", "today's gain/loss $", "daily gain/loss $", "day gain/loss $");
  const todayPctIdx     = findCol("today's gain/loss percent", "today's gain/loss %", "daily gain/loss %");
  const totalDollarIdx  = findCol("total gain/loss dollar", "total gain/loss $", "unrealized gain/loss $");
  const totalPctIdx     = findCol("total gain/loss percent", "total gain/loss %", "unrealized gain/loss %");
  const pctOfAccountIdx = findCol("percent of account", "% of account", "portfolio %");

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s.replace(/[$%+,'"]/g, "").trim());
    return isNaN(n) ? null : n;
  };
  const parseStr = (s: string): string | null =>
    (s ?? "").replace(/['"]/g, "").trim() || null;

  const positionMap = new Map<string, CsvPosition>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const raw = (cols[symbolIdx] ?? "").replace(/['"]/g, "").trim().toUpperCase();

    // Validate ticker symbol
    if (!raw || !/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(raw)) continue;
    if (["--", "N/A", "CASH", "PENDING"].includes(raw)) continue;

    const qty         = qtyIdx >= 0          ? parseNum(cols[qtyIdx] ?? "")          : null;
    const costTotal   = costTotalIdx >= 0     ? parseNum(cols[costTotalIdx] ?? "")    : null;
    const avgCost     = avgCostIdx >= 0       ? parseNum(cols[avgCostIdx] ?? "")      : null;
    const account     = accountIdx >= 0       ? parseStr(cols[accountIdx] ?? "")      : null;
    const description = descriptionIdx >= 0   ? parseStr(cols[descriptionIdx] ?? "")  : null;
    const todayDollar = todayDollarIdx >= 0   ? parseNum(cols[todayDollarIdx] ?? "")  : null;
    const todayPct    = todayPctIdx >= 0      ? parseNum(cols[todayPctIdx] ?? "")     : null;
    const totalDollar = totalDollarIdx >= 0   ? parseNum(cols[totalDollarIdx] ?? "")  : null;
    const totalPct    = totalPctIdx >= 0      ? parseNum(cols[totalPctIdx] ?? "")     : null;
    const pctOfAcct   = pctOfAccountIdx >= 0  ? parseNum(cols[pctOfAccountIdx] ?? "") : null;

    // Skip rows without a valid quantity (money market, pending activity, etc.)
    if (qty === null) continue;

    if (positionMap.has(raw)) {
      // Aggregate across accounts — sum qty, cost basis; recalc avg; join accounts; sum today/total G/L
      const prev = positionMap.get(raw)!;
      const newQty        = (prev.quantity ?? 0) + qty;
      const newCostTotal  = prev.costBasisTotal !== null && costTotal !== null
        ? prev.costBasisTotal + costTotal : (prev.costBasisTotal ?? costTotal);
      const newAvg        = newQty > 0 && newCostTotal !== null ? newCostTotal / newQty : avgCost;
      const accounts      = [prev.accountName, account].filter(Boolean).join(" / ");
      const newTodayDollar = prev.todayGainLossDollar !== null && todayDollar !== null
        ? prev.todayGainLossDollar + todayDollar : (prev.todayGainLossDollar ?? todayDollar);
      const newTotalDollar = prev.totalGainLossDollar !== null && totalDollar !== null
        ? prev.totalGainLossDollar + totalDollar : (prev.totalGainLossDollar ?? totalDollar);
      positionMap.set(raw, {
        ticker: raw,
        description: prev.description ?? description,
        quantity: newQty,
        costBasisTotal: newCostTotal,
        avgCostBasis: newAvg,
        accountName: accounts || null,
        todayGainLossDollar: newTodayDollar,
        todayGainLossPercent: todayPct,   // % doesn't aggregate simply; use last
        totalGainLossDollar: newTotalDollar,
        totalGainLossPercent: totalPct,
        percentOfAccount: (prev.percentOfAccount ?? 0) + (pctOfAcct ?? 0) || null,
      });
    } else {
      positionMap.set(raw, {
        ticker: raw, description, quantity: qty, costBasisTotal: costTotal,
        avgCostBasis: avgCost, accountName: account,
        todayGainLossDollar: todayDollar, todayGainLossPercent: todayPct,
        totalGainLossDollar: totalDollar, totalGainLossPercent: totalPct,
        percentOfAccount: pctOfAcct,
      });
    }
  }

  return [...positionMap.values()];
}

function formatPnl(val: number | null): string {
  if (val === null) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
}

function formatPnlPct(val: number | null): string {
  if (val === null) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

export default function Watchlist() {
  const [ticker, setTicker] = useState("");
  const [alertPanelTicker, setAlertPanelTicker] = useState<string | null>(null);
  const [newCondition, setNewCondition] = useState<"score_above" | "score_below" | "direction_change" | "price_above" | "price_below">("score_above");
  const [newThreshold, setNewThreshold] = useState("70");
  const [csvStatus, setCsvStatus] = useState<{ imported: number; failed: number } | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const positionMutation = useUpdateWatchlistPosition();
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const syncMutation = useRefreshWatchlistPrices({
    mutation: {
      onSuccess: (data) => {
        qc.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
        setSyncStatus(`Updated today's G/L for ${data.updated} position${data.updated !== 1 ? "s" : ""}`);
        setTimeout(() => setSyncStatus(null), 4000);
      },
    },
  });

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

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setCsvStatus(null);
    setCsvImporting(true);

    const text = await file.text();
    const positions = parseCsvPositions(text);

    if (positions.length === 0) {
      setCsvImporting(false);
      setCsvStatus({ imported: 0, failed: 0 });
      return;
    }

    let imported = 0;
    let failed = 0;

    for (const pos of positions) {
      try {
        await new Promise<void>((resolve, reject) =>
          positionMutation.mutate(
            {
              ticker: pos.ticker,
              data: {
                quantity: pos.quantity,
                costBasisTotal: pos.costBasisTotal,
                avgCostBasis: pos.avgCostBasis,
                accountName: pos.accountName,
                description: pos.description,
                todayGainLossDollar: pos.todayGainLossDollar,
                todayGainLossPercent: pos.todayGainLossPercent,
                totalGainLossDollar: pos.totalGainLossDollar,
                totalGainLossPercent: pos.totalGainLossPercent,
                percentOfAccount: pos.percentOfAccount,
              },
            },
            { onSuccess: () => resolve(), onError: () => reject() }
          )
        );
        imported++;
      } catch {
        failed++;
      }
    }

    await qc.invalidateQueries({ queryKey: getGetWatchlistQueryKey() });
    setCsvImporting(false);
    setCsvStatus({ imported, failed });
    setTimeout(() => setCsvStatus(null), 8000);
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

  // Determine if any item has broker position data
  const hasPositions = (watchlist ?? []).some(item => item.quantity !== null);
  // Total columns for colSpan
  const totalCols = hasPositions ? 15 : 7;

  return (
    <div className={cn("flex-1 p-6 overflow-hidden flex flex-col h-full mx-auto w-full", hasPositions ? "max-w-7xl" : "max-w-5xl")}>

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

      <div className="mb-6 flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display tracking-widest text-primary mb-2">WATCHLIST MANAGEMENT</h1>
          <p className="text-muted-foreground font-mono text-sm">Monitor active targets and score changes.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            {/* CSV import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvFile}
            />
            <Button
              type="button"
              variant="outline"
              disabled={csvImporting}
              onClick={() => fileInputRef.current?.click()}
              className="font-mono border-border text-muted-foreground hover:text-foreground"
              title="Import positions from a broker CSV (Fidelity, Schwab, TD)"
            >
              <Upload className="w-4 h-4 mr-2" />
              {csvImporting ? "IMPORTING…" : "IMPORT CSV"}
            </Button>

            {/* Sync today G/L from live quotes */}
            <Button
              type="button"
              variant="outline"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
              className="font-mono border-border text-muted-foreground hover:text-foreground"
              title="Refresh today's gain/loss from live prices"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", syncMutation.isPending && "animate-spin")} />
              {syncMutation.isPending ? "SYNCING…" : "SYNC PRICES"}
            </Button>

            {/* Manual add */}
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

          {/* Sync prices status badge */}
          {syncStatus && (
            <div className="text-xs font-mono px-3 py-1 rounded border bg-success/10 border-success/30 text-success">
              ✓ {syncStatus}
            </div>
          )}

          {/* CSV result badge */}
          {csvStatus && (
            <div className={cn(
              "text-xs font-mono px-3 py-1 rounded border",
              csvStatus.imported > 0
                ? "bg-success/10 border-success/30 text-success"
                : "bg-muted/30 border-border text-muted-foreground"
            )}>
              {csvStatus.imported > 0
                ? `✓ ${csvStatus.imported} position${csvStatus.imported !== 1 ? "s" : ""} imported${csvStatus.failed > 0 ? ` · ${csvStatus.failed} failed` : ""}`
                : "No valid positions found in CSV"}
            </div>
          )}
        </div>
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
                {hasPositions && <>
                  <th className="p-4 font-medium text-right">QTY</th>
                  <th className="p-4 font-medium text-right">AVG COST</th>
                  <th className="p-4 font-medium text-right">MKT VAL</th>
                  <th className="p-4 font-medium text-right">UNREAL P&amp;L</th>
                  <th className="p-4 font-medium text-right">UNREAL %</th>
                  <th className="p-4 font-medium text-right">TODAY G/L</th>
                  <th className="p-4 font-medium text-right">TOTAL G/L</th>
                  <th className="p-4 font-medium text-right">% OF ACCT</th>
                  <th className="p-4 font-medium">ACCOUNT</th>
                </>}
                <th className="p-4 font-medium text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {watchlist.map((item) => {
                const ta = tickerAlerts(item.ticker);
                const isPanelOpen = alertPanelTicker === item.ticker;

                // Computed position metrics
                const mktVal = item.price !== null && item.quantity !== null
                  ? item.price * item.quantity : null;
                const unrealPnl = mktVal !== null && item.costBasisTotal !== null
                  ? mktVal - item.costBasisTotal : null;
                const unrealPct = unrealPnl !== null && item.costBasisTotal !== null && item.costBasisTotal > 0
                  ? (unrealPnl / item.costBasisTotal) * 100 : null;

                return (
                  <React.Fragment key={item.id}>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="p-4">
                        <Link href={`/?ticker=${item.ticker}`} className="hover:underline font-bold text-primary">
                          {item.ticker}
                        </Link>
                        {item.description && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={item.description}>
                            {item.description}
                          </div>
                        )}
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

                      {hasPositions && <>
                        <td className="p-4 text-right text-muted-foreground">
                          {item.quantity !== null ? item.quantity.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                        </td>
                        <td className="p-4 text-right text-muted-foreground">
                          {item.avgCostBasis !== null ? formatCurrency(item.avgCostBasis) : "—"}
                        </td>
                        <td className="p-4 text-right text-foreground">
                          {mktVal !== null ? formatCurrency(mktVal) : "—"}
                        </td>
                        <td className={cn("p-4 text-right font-medium", unrealPnl === null ? "text-muted-foreground" : unrealPnl >= 0 ? "text-success" : "text-destructive")}>
                          {formatPnl(unrealPnl)}
                        </td>
                        <td className={cn("p-4 text-right font-medium", unrealPct === null ? "text-muted-foreground" : unrealPct >= 0 ? "text-success" : "text-destructive")}>
                          {formatPnlPct(unrealPct)}
                        </td>
                        <td className={cn("p-4 text-right", item.todayGainLossDollar === null ? "text-muted-foreground" : item.todayGainLossDollar >= 0 ? "text-success" : "text-destructive")}>
                          {item.todayGainLossDollar !== null ? (
                            <div>{formatPnl(item.todayGainLossDollar)}</div>
                          ) : "—"}
                          {item.todayGainLossPercent !== null && (
                            <div className="text-[10px] opacity-70">{formatPnlPct(item.todayGainLossPercent)}</div>
                          )}
                        </td>
                        <td className={cn("p-4 text-right", item.totalGainLossDollar === null ? "text-muted-foreground" : item.totalGainLossDollar >= 0 ? "text-success" : "text-destructive")}>
                          {item.totalGainLossDollar !== null ? (
                            <div>{formatPnl(item.totalGainLossDollar)}</div>
                          ) : "—"}
                          {item.totalGainLossPercent !== null && (
                            <div className="text-[10px] opacity-70">{formatPnlPct(item.totalGainLossPercent)}</div>
                          )}
                        </td>
                        <td className="p-4 text-right text-muted-foreground">
                          {item.percentOfAccount !== null ? `${item.percentOfAccount.toFixed(1)}%` : "—"}
                        </td>
                        <td className="p-4 text-xs text-muted-foreground max-w-[120px] truncate" title={item.accountName ?? ""}>
                          {item.accountName ?? "—"}
                        </td>
                      </>}

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
                        <td colSpan={totalCols} className="bg-card/80 border-t border-b border-primary/20">
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
                                <option value="price_above">Price ≥ $</option>
                                <option value="price_below">Price ≤ $</option>
                                <option value="direction_change">Direction changes</option>
                              </select>
                              {newCondition !== "direction_change" && (
                                <input
                                  type="number"
                                  min={0}
                                  step={newCondition === "price_above" || newCondition === "price_below" ? "0.01" : "1"}
                                  max={newCondition === "price_above" || newCondition === "price_below" ? undefined : 100}
                                  value={newThreshold}
                                  onChange={e => setNewThreshold(e.target.value)}
                                  className="w-24 text-xs font-mono bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-primary"
                                  placeholder={newCondition === "price_above" || newCondition === "price_below" ? "price" : "0–100"}
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
