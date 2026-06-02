import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { X, Play, Pause, Zap, Brain, TrendingUp, TrendingDown, Clock, DollarSign, Target, AlertTriangle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomCriterion {
  field: string;
  operator: string;
  value: string | number;
  value2?: number;
}

interface BotConfig {
  id: number;
  name: string;
  enabled: boolean;
  entryCriteria: CustomCriterion[];
  maxPositions: number;
  positionSizePct: number;
  exitScoreThreshold: number;
  exitOnDirectionFlip: boolean;
  maxHoldDays: number;
  virtualPortfolio: number;
  takeProfitPct: number;
  stopLossPct: number;
  tickerWhitelist: string;
  aiGateEnabled: boolean;
  updatedAt: string;
}

interface PaperTrade {
  id: number;
  ticker: string;
  name: string;
  entryPrice: number;
  entryScore: number;
  entryDirection: string;
  entryBullishProb: number | null;
  entryRsi: number | null;
  entryRvol: number | null;
  entryPatterns?: string[] | null;
  entryAt: string;
  exitPrice: number | null;
  exitScore: number | null;
  exitReason: string | null;
  exitAt: string | null;
  pnlPercent: number | null;
  pnlDollar: number | null;
  positionValue: number | null;
  status: string;
  aiNotes: string | null;
  currentPrice?: number;
  currentScore?: number;
  unrealizedPnlPct?: number;
  unrealizedPnlDollar?: number;
  holdDays?: number;
  currentCyclePhase?: string;
  currentWeeklyPatterns?: string[];
}

interface SignalGroup {
  label: string;
  trades: number;
  winRate: number;
  avgPnl: number;
  bestPnl: number;
  worstPnl: number;
}

interface SignalPerformance {
  byScoreBucket: SignalGroup[];
  byRsiRange: SignalGroup[];
  byRvol: SignalGroup[];
  byPattern: SignalGroup[];
  totalClosed: number;
  bestSignal: string;
  worstSignal: string;
}

interface BotStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winRate: number;
  avgPnlPct: number;
  totalPnlPct: number;
  bestTrade: number;
  worstTrade: number;
  avgHoldDays: number;
  byExitReason: Record<string, { count: number; avgPnl: number }>;
  virtualPortfolioValue: number;
}

interface BotStatus {
  enabled: boolean;
  cycleRunning: boolean;
  lastRunAt: string | null;
  openCount: number;
  closedCount: number;
  winRate: number;
  virtualPortfolioValue: number;
}

// ── Filter-builder constants (mirrors Scanner.tsx) ────────────────────────────

type CsFieldType = "number" | "enum" | "string" | "array" | "pattern";
interface CsFieldConfig { key: string; label: string; type: CsFieldType; options?: string[]; hint?: string }

const CS_FIELDS: CsFieldConfig[] = [
  { key: "score",              label: "Score",               type: "number", hint: "0–100" },
  { key: "trendScore",         label: "Trend Score",         type: "number", hint: "0–100" },
  { key: "momentumScore",      label: "Momentum Score",      type: "number", hint: "0–100" },
  { key: "volumeScore",        label: "Volume Score",        type: "number", hint: "0–100" },
  { key: "relStrengthScore",   label: "Rel Strength Score",  type: "number", hint: "0–100" },
  { key: "exhaustionScore",    label: "Exhaustion Score",    type: "number", hint: "0–100" },
  { key: "bullishProbability", label: "Bull Probability %",  type: "number", hint: "0–100" },
  { key: "rsi",                label: "RSI",                 type: "number", hint: "0–100" },
  { key: "stochK",             label: "Stoch K",             type: "number", hint: "0–100" },
  { key: "relativeVolume",     label: "Rel. Volume (×)",     type: "number", hint: "e.g. 1.5" },
  { key: "atrPercent",         label: "ATR %",               type: "number", hint: "e.g. 3.0" },
  { key: "bbWidthPct",         label: "BB Width %",          type: "number", hint: "e.g. 15" },
  { key: "priceVsSma50",       label: "vs SMA50 %",          type: "number", hint: "e.g. 5.0" },
  { key: "priceVsSma200",      label: "vs SMA200 %",         type: "number", hint: "e.g. 10.0" },
  { key: "changePercent",      label: "Day Change %",        type: "number", hint: "e.g. 2.0" },
  { key: "price",              label: "Price ($)",           type: "number" },
  { key: "direction",          label: "Direction",           type: "enum",   options: ["bullish", "neutral", "bearish"] },
  { key: "signalStrength",     label: "Signal Strength",     type: "enum",   options: ["strong", "moderate", "weak"] },
  { key: "exhaustion",         label: "Exhaustion Signal",   type: "enum",   options: ["none", "distribution_top", "capitulation"] },
  { key: "pullbackClass",      label: "Setup Type",          type: "enum",   options: ["pullback", "reversal", "ambiguous", "extended"] },
  { key: "patterns",           label: "Pattern (Daily)",     type: "array",  hint: "e.g. Bull Flag" },
  // ── Multi-timeframe / cycle fields ───────────────────────────────────────────
  { key: "cyclePhase",         label: "Cycle Phase",         type: "enum",   options: ["accumulation", "markup", "distribution", "markdown", "ranging"] },
  { key: "weeklyPatterns",     label: "Pattern (Weekly)",    type: "array",  hint: "e.g. Weekly Bull Flag" },
  { key: "sma40Rising",        label: "Weekly Trend (200d)", type: "enum",   options: ["yes", "no"] },
  { key: "weeklyRsi",          label: "Weekly RSI",          type: "number", hint: "0–100" },
  { key: "distFrom52wHigh",    label: "vs 52W High %",       type: "number", hint: "e.g. -10 = within 10%" },
  { key: "priceVsSma40Weekly", label: "vs Weekly SMA200 %",  type: "number", hint: "e.g. 5.0" },
  { key: "pattern",            label: "Pattern",             type: "pattern" },
  // ── Candle structure ─────────────────────────────────────────────────────
  { key: "distributionCandles", label: "Distribution Candles", type: "number", hint: "upper wick >40% in last 5" },
  { key: "climaxBars",          label: "Climax Bars",          type: "number", hint: "vol >2× avg + green in last 5" },
  { key: "downDayVolumeRatio",  label: "Down/Up Vol Ratio",    type: "number", hint: ">1.2 = distribution pressure" },
  { key: "parabolicMovePct",    label: "Parabolic Move %",     type: "number", hint: "% from 60-bar low to high" },
  { key: "consecutiveRedDays",  label: "Consecutive Red Days", type: "number", hint: "current red streak" },
  { key: "priceExtensionPct",   label: "Extension from SMA20 %", type: "number", hint: "% above 20-day avg" },
];

const CS_OPS: Record<CsFieldType, { value: string; label: string }[]> = {
  number:  [
    { value: "gte", label: "≥" }, { value: "lte", label: "≤" },
    { value: "gt",  label: ">" }, { value: "lt",  label: "<" },
    { value: "eq",  label: "=" }, { value: "neq", label: "≠" },
    { value: "between", label: "between" },
  ],
  enum:    [{ value: "eq", label: "is" }, { value: "neq", label: "is not" }],
  string:  [{ value: "eq", label: "is" }, { value: "contains", label: "contains" }, { value: "notContains", label: "not contains" }],
  array:   [{ value: "contains", label: "contains" }, { value: "notContains", label: "not contains" }],
  pattern: [{ value: "includes", label: "includes" }],
};

interface BotPreset {
  label: string;
  color: string;
  criteria: { field: string; operator: string; value: string; value2?: string }[];
}

const BOT_PRESETS: BotPreset[] = [
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
    label: "HIGH SCORE BULL",
    color: "border-primary/50 text-primary hover:bg-primary/10",
    criteria: [
      { field: "score",              operator: "gte", value: "80" },
      { field: "direction",          operator: "eq",  value: "bullish" },
      { field: "bullishProbability", operator: "gte", value: "75" },
    ],
  },
  {
    label: "MOMENTUM SURGE",
    color: "border-warning/50 text-warning hover:bg-warning/10",
    criteria: [
      { field: "momentumScore",  operator: "gte", value: "78" },
      { field: "relativeVolume", operator: "gte", value: "1.5" },
      { field: "direction",      operator: "eq",  value: "bullish" },
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
    label: "DEEP PULLBACK",
    color: "border-success/50 text-success hover:bg-success/10",
    criteria: [
      { field: "score",         operator: "gte",     value: "68" },
      { field: "priceVsSma50",  operator: "between", value: "-8", value2: "-2" },
      { field: "rsi",           operator: "between", value: "38", value2: "52" },
    ],
  },
];

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

// ── Filter row state ──────────────────────────────────────────────────────────

let _rowId = 0;
interface FilterRow { id: number; field: string; operator: string; value: string; value2: string }

function newRow(field = "score", op?: string, val = "", val2 = ""): FilterRow {
  const fc = CS_FIELDS.find(f => f.key === field) ?? CS_FIELDS[0];
  return { id: ++_rowId, field, operator: op ?? CS_OPS[fc.type][0].value, value: val, value2: val2 };
}

function criteriaToRows(criteria: CustomCriterion[]): FilterRow[] {
  return criteria.map(c => ({
    id:       ++_rowId,
    field:    c.field,
    operator: c.operator,
    value:    String(c.value),
    value2:   c.value2 !== undefined ? String(c.value2) : "",
  }));
}

function rowsToCriteria(rows: FilterRow[]): CustomCriterion[] {
  return rows
    .filter(r => r.value.trim() !== "" || r.operator === "contains" || r.operator === "notContains")
    .map(r => {
      const num = parseFloat(r.value);
      const c: CustomCriterion = {
        field:    r.field,
        operator: r.operator,
        value:    isNaN(num) ? r.value : num,
      };
      if (r.operator === "between" && r.value2.trim()) c.value2 = parseFloat(r.value2);
      return c;
    });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PnlBadge({ pct, dollar }: { pct: number | null | undefined; dollar?: number | null }) {
  if (pct == null) return <span className="text-muted-foreground font-mono text-xs">—</span>;
  const pos = pct >= 0;
  return (
    <span className={cn("font-mono text-xs font-bold", pos ? "text-success" : "text-destructive")}>
      {pos ? "+" : ""}{pct.toFixed(2)}%
      {dollar != null && <span className="font-normal ml-1 opacity-70">({pos ? "+" : ""}{formatCurrency(dollar)})</span>}
    </span>
  );
}

function ExitReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return null;
  const styles: Record<string, string> = {
    take_profit:    "bg-success/20 text-success border-success/30",
    stop_loss:      "bg-destructive/25 text-destructive border-destructive/40",
    score_drop:     "bg-destructive/20 text-destructive border-destructive/30",
    direction_flip: "bg-warning/20 text-warning border-warning/30",
    max_hold:       "bg-muted/40 text-muted-foreground border-border",
    manual:         "bg-primary/20 text-primary border-primary/30",
  };
  const labels: Record<string, string> = {
    take_profit:    "✓ TAKE PROFIT",
    stop_loss:      "✗ STOP LOSS",
    score_drop:     "SCORE ↓",
    direction_flip: "DIR FLIP",
    max_hold:       "MAX HOLD",
    manual:         "MANUAL",
  };
  return (
    <span className={cn("px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold", styles[reason] ?? "bg-muted text-muted-foreground")}>
      {labels[reason] ?? reason.toUpperCase()}
    </span>
  );
}

function ScoreChip({ score, dim }: { score: number | null; dim?: boolean }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color = score >= 75 ? "bg-success/20 text-success" : score >= 55 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive";
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono font-bold", color, dim && "opacity-60")}>
      {score}
    </span>
  );
}

// ── CONFIG TAB ────────────────────────────────────────────────────────────────

function ConfigTab({ config, onSaved }: { config: BotConfig; onSaved: () => void }) {
  const qc = useQueryClient();

  const { data: patternsData } = useQuery<{ patterns: string[] }>({
    queryKey: ["bot-patterns"],
    queryFn:  () => apiFetch("bot/patterns"),
    staleTime: Infinity,
  });
  const { data: weeklyPatternsData } = useQuery<{ patterns: string[] }>({
    queryKey: ["bot-weekly-patterns"],
    queryFn:  () => apiFetch("bot/weekly-patterns"),
    staleTime: Infinity,
  });

  const availablePatterns = patternsData?.patterns ?? [];
  const availableWeeklyPatterns = weeklyPatternsData?.patterns ?? [];
  const [rows, setRows]             = useState<FilterRow[]>(() => criteriaToRows(config.entryCriteria));
  const [exitScore, setExitScore]   = useState(config.exitScoreThreshold);
  const [dirFlip, setDirFlip]       = useState(config.exitOnDirectionFlip);
  const [maxHold, setMaxHold]       = useState(config.maxHoldDays);
  const [maxPos, setMaxPos]         = useState(config.maxPositions);
  const [posSizePct, setPosSizePct]       = useState(config.positionSizePct);
  const [portfolio, setPortfolio]         = useState(config.virtualPortfolio);
  const [takeProfitPct, setTakeProfitPct] = useState(config.takeProfitPct);
  const [stopLossPct, setStopLossPct]     = useState(config.stopLossPct);
  const [tickerWhitelist, setTickerWhitelist] = useState(config.tickerWhitelist);
  const [aiGateEnabled, setAiGateEnabled]     = useState(config.aiGateEnabled ?? false);

  function handleTakeProfitChange(val: number) {
    setTakeProfitPct(val);
    if (val > 0) setStopLossPct(Math.round(val / 3 * 100) / 100);
    else setStopLossPct(0);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiFetch<BotConfig>("bot/config", {
      method: "PUT",
      body: JSON.stringify({
        entryCriteria:       rowsToCriteria(rows),
        exitScoreThreshold:  exitScore,
        exitOnDirectionFlip: dirFlip,
        maxHoldDays:         maxHold,
        takeProfitPct,
        stopLossPct,
        tickerWhitelist,
        aiGateEnabled,
        maxPositions:        maxPos,
        positionSizePct:     posSizePct,
        virtualPortfolio:    portfolio,
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bot-config"] }); onSaved(); },
  });

  function applyPreset(p: BotPreset) {
    setRows(p.criteria.map(c => newRow(c.field, c.operator, c.value, c.value2 ?? "")));
  }

  function updateRow(id: number, patch: Partial<FilterRow>) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, ...patch };
      if (patch.field && patch.field !== r.field) {
        const fc = CS_FIELDS.find(f => f.key === patch.field) ?? CS_FIELDS[0];
        updated.operator = CS_OPS[fc.type][0].value;
        updated.value    = "";
        updated.value2   = "";
      }
      return updated;
    }));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Entry Criteria */}
      <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Entry Criteria</div>
          <div className="text-xs font-mono text-muted-foreground/60">All criteria are ANDed · bot scans 590 tickers each cycle</div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-mono text-muted-foreground/60 self-center mr-1">PRESETS:</span>
          {BOT_PRESETS.map(p => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className={cn("px-2.5 py-0.5 rounded border text-xs font-mono transition-colors", p.color)}>
              {p.label}
            </button>
          ))}
        </div>

        {rows.length === 0 && (
          <div className="text-xs font-mono text-muted-foreground/40 italic py-1">No filters — bot will open positions on highest-scoring tickers.</div>
        )}

        {rows.map(row => {
          const fc        = CS_FIELDS.find(f => f.key === row.field) ?? CS_FIELDS[0];
          const ops       = CS_OPS[fc.type];
          const isBetw    = row.operator === "between";
          const isEnum    = fc.type === "enum";
          const isPattern = fc.type === "pattern";

          return (
            <div key={row.id} className="flex items-center gap-1.5 flex-wrap">
              <select value={row.field} onChange={e => updateRow(row.id, { field: e.target.value })}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary min-w-[155px]">
                {CS_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <select value={row.operator} onChange={e => updateRow(row.id, { operator: e.target.value })}
                className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary w-[108px]">
                {ops.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
              </select>
              {isPattern ? (
                <>
                  <input
                    list="available-patterns"
                    value={row.value}
                    onChange={e => updateRow(row.id, { value: e.target.value })}
                    placeholder="Search pattern..."
                    className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary min-w-[200px]"
                  />
                  <datalist id="available-patterns">
                    {availablePatterns.map(p => <option key={p} value={p} />)}
                  </datalist>
                </>
              ) : isEnum ? (
                <select value={row.value} onChange={e => updateRow(row.id, { value: e.target.value })}
                  className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary min-w-[120px]">
                  <option value="">— select —</option>
                  {fc.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : fc.type === "array" ? (
                <select value={row.value} onChange={e => updateRow(row.id, { value: e.target.value })}
                  className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary min-w-[180px]">
                  <option value="">— select pattern —</option>
                  {(row.field === "weeklyPatterns" ? availableWeeklyPatterns : availablePatterns).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input type="number" placeholder={isBetw ? "min" : (fc.hint ?? "value")}
                    value={row.value} onChange={e => updateRow(row.id, { value: e.target.value })}
                    className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary w-[88px] placeholder:text-muted-foreground/40" />
                  {isBetw && <>
                    <span className="text-xs text-muted-foreground">—</span>
                    <input type="number" placeholder="max" value={row.value2} onChange={e => updateRow(row.id, { value2: e.target.value })}
                      className="bg-background border border-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-primary w-[88px] placeholder:text-muted-foreground/40" />
                  </>}
                </>
              )}
              <button onClick={() => setRows(r => r.filter(x => x.id !== row.id))}
                className="p-1 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        <div className="flex gap-2 pt-1 border-t border-border/40">
          <button onClick={() => setRows(r => [...r, newRow()])}
            className="text-xs font-mono text-primary/70 hover:text-primary border border-primary/30 hover:border-primary/60 rounded px-2.5 py-1 transition-colors">
            + ADD FILTER
          </button>
          {rows.length > 0 && (
            <button onClick={() => setRows([])}
              className="text-xs font-mono text-muted-foreground/40 hover:text-muted-foreground border border-border/30 hover:border-border rounded px-2.5 py-1 transition-colors">
              CLEAR
            </button>
          )}
        </div>
      </div>

      {/* Exit Rules + Sizing — side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Exit Rules</div>

          {/* 3:1 R:R price exits */}
          <div className="border border-success/20 rounded p-2.5 flex flex-col gap-2 bg-success/5">
            <div className="text-[10px] font-mono text-success/70 uppercase tracking-wider">Price-Based Exits (R:R)</div>
            <label className="flex items-center justify-between">
              <span className="text-xs font-mono text-foreground">Take profit at (%)</span>
              <input type="number" min={0} step={0.5} placeholder="e.g. 9"
                value={takeProfitPct || ""} onChange={e => handleTakeProfitChange(Number(e.target.value))}
                className="bg-background border border-success/30 rounded px-2 py-1 text-xs font-mono text-success w-20 text-center focus:outline-none focus:border-success" />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-xs font-mono text-foreground">
                Stop loss at (%) <span className="text-muted-foreground/50">← auto 1R</span>
              </span>
              <input type="number" min={0} step={0.5} placeholder="e.g. 3"
                value={stopLossPct || ""} onChange={e => setStopLossPct(Number(e.target.value))}
                className="bg-background border border-destructive/30 rounded px-2 py-1 text-xs font-mono text-destructive w-20 text-center focus:outline-none focus:border-destructive" />
            </label>
            {takeProfitPct > 0 && stopLossPct > 0 && (
              <div className="text-[10px] font-mono text-muted-foreground/60 text-center">
                R:R ratio = {(takeProfitPct / stopLossPct).toFixed(1)}:1
                &nbsp;·&nbsp;+{takeProfitPct}% target / −{stopLossPct}% stop
              </div>
            )}
          </div>

          {/* Score/direction exits */}
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground">Exit if score drops below</span>
            <input type="number" min={0} max={100} value={exitScore} onChange={e => setExitScore(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-16 text-center focus:outline-none focus:border-primary" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs font-mono text-foreground">Exit on direction flip to bearish</span>
            <button onClick={() => setDirFlip(v => !v)}
              className={cn("w-10 h-5 rounded-full transition-colors relative", dirFlip ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", dirFlip ? "left-5" : "left-0.5")} />
            </button>
          </label>
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground">Max hold days (safety fallback)</span>
            <input type="number" min={1} max={365} value={maxHold} onChange={e => setMaxHold(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-16 text-center focus:outline-none focus:border-primary" />
          </label>
        </div>

        <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Smart Entry Gate</div>
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <div className="text-xs font-mono text-foreground">Enable candle structure gate</div>
              <div className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                Blocks entries on distribution tops, parabolic exhaustion, contrarian IC signals &amp; overextension — zero latency, no API cost
              </div>
            </div>
            <button onClick={() => setAiGateEnabled(v => !v)}
              className={cn("w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ml-4", aiGateEnabled ? "bg-primary" : "bg-muted")}>
              <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform", aiGateEnabled ? "left-5" : "left-0.5")} />
            </button>
          </label>
          {aiGateEnabled && (
            <div className="text-[10px] font-mono text-primary/70 bg-primary/5 rounded px-2 py-1.5 leading-relaxed">
              ✦ Active — uses exhaustion engine, candle wick analysis, IC calibration &amp; SMA extension to filter entries. Reason logged to trade notes on each blocked pick.
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-md p-4 flex flex-col gap-3">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mt-1">Ticker Whitelist</div>
          <div>
            <input type="text" placeholder="e.g. LMT, NOC, RTX, GD, LHX, HII (leave blank for all 580 tickers)"
              value={tickerWhitelist} onChange={e => setTickerWhitelist(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-full focus:outline-none focus:border-primary placeholder:text-muted-foreground/30" />
            {tickerWhitelist && (
              <div className="text-[10px] font-mono text-muted-foreground/50 mt-0.5">
                {tickerWhitelist.split(",").map(t => t.trim()).filter(Boolean).length} tickers whitelisted
              </div>
            )}
          </div>

          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mt-1">Position Sizing</div>
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground">Max concurrent positions</span>
            <input type="number" min={1} max={20} value={maxPos} onChange={e => setMaxPos(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-16 text-center focus:outline-none focus:border-primary" />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground">Position size (% of portfolio)</span>
            <input type="number" min={1} max={100} value={posSizePct} onChange={e => setPosSizePct(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-16 text-center focus:outline-none focus:border-primary" />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground">Virtual portfolio ($)</span>
            <input type="number" min={1000} value={portfolio} onChange={e => setPortfolio(Number(e.target.value))}
              className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground w-28 text-center focus:outline-none focus:border-primary" />
          </label>
        </div>
      </div>

      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className={cn(
          "w-full py-2 rounded font-mono text-sm font-bold tracking-wider transition-colors",
          saveMutation.isPending
            ? "bg-muted text-muted-foreground cursor-not-allowed"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}>
        {saveMutation.isPending ? "SAVING…" : saveMutation.isSuccess ? "✓ SAVED" : "SAVE CONFIG"}
      </button>

      {saveMutation.isError && (
        <div className="text-xs font-mono text-destructive">Failed to save config.</div>
      )}
    </div>
  );
}

// ── POSITIONS TAB ─────────────────────────────────────────────────────────────

// ── Cycle phase badge ─────────────────────────────────────────────────────────

const CYCLE_COLORS: Record<string, string> = {
  markup:       "text-success border-success/50 bg-success/5",
  accumulation: "text-blue-400 border-blue-400/50 bg-blue-400/5",
  distribution: "text-warning border-warning/50 bg-warning/5",
  markdown:     "text-destructive border-destructive/50 bg-destructive/5",
  ranging:      "text-muted-foreground border-border bg-muted/10",
};

const CYCLE_LABELS: Record<string, string> = {
  markup:       "MARKUP ↑",
  accumulation: "ACCUM.",
  distribution: "DIST. ↓",
  markdown:     "MARKDOWN",
  ranging:      "RANGING",
};

function CycleBadge({ phase }: { phase?: string }) {
  if (!phase) return <span className="text-muted-foreground/30">—</span>;
  return (
    <span className={cn(
      "text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border whitespace-nowrap",
      CYCLE_COLORS[phase] ?? CYCLE_COLORS.ranging,
    )}>
      {CYCLE_LABELS[phase] ?? phase.toUpperCase()}
    </span>
  );
}

function PositionsTab({ trades, onClose }: { trades: PaperTrade[]; onClose: (id: number) => void }) {
  const open = trades.filter(t => t.status === "open");

  if (open.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs font-mono text-muted-foreground/40 border border-border/30 rounded-md">
        No open positions — run a cycle to let the bot find setups
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 px-2">TICKER</th>
            <th className="text-right py-2 px-2">ENTRY</th>
            <th className="text-right py-2 px-2">CURRENT</th>
            <th className="text-right py-2 px-2">P&L</th>
            <th className="text-right py-2 px-2">SCORE</th>
            <th className="text-center py-2 px-2">CYCLE</th>
            <th className="text-right py-2 px-2">RSI@ENTRY</th>
            <th className="text-right py-2 px-2">HOLD</th>
            <th className="text-center py-2 px-2">CLOSE</th>
          </tr>
        </thead>
        <tbody>
          {open.map(t => (
            <tr key={t.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-2">
                <div className="font-bold text-primary">{t.ticker}</div>
                <div className="text-muted-foreground/60 text-[10px] max-w-[120px] truncate">{t.name}</div>
              </td>
              <td className="text-right py-2 px-2">{formatCurrency(t.entryPrice)}</td>
              <td className="text-right py-2 px-2">
                {t.currentPrice ? formatCurrency(t.currentPrice) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="text-right py-2 px-2">
                <PnlBadge pct={t.unrealizedPnlPct} dollar={t.unrealizedPnlDollar} />
              </td>
              <td className="text-right py-2 px-2">
                <div className="flex items-center justify-end gap-1">
                  <ScoreChip score={t.entryScore} dim />
                  {t.currentScore != null && <><span className="text-muted-foreground/40">→</span><ScoreChip score={t.currentScore} /></>}
                </div>
              </td>
              <td className="text-center py-2 px-2">
                <div className="flex flex-col items-center gap-0.5">
                  <CycleBadge phase={t.currentCyclePhase} />
                  {t.currentWeeklyPatterns && t.currentWeeklyPatterns.length > 0 && (
                    <div className="text-[9px] font-mono text-muted-foreground/50 max-w-[90px] truncate" title={t.currentWeeklyPatterns.join(", ")}>
                      {t.currentWeeklyPatterns[0].replace("Weekly ", "W:")}
                    </div>
                  )}
                </div>
              </td>
              <td className="text-right py-2 px-2 text-muted-foreground">{t.entryRsi?.toFixed(1) ?? "—"}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{t.holdDays ?? 0}d</td>
              <td className="text-center py-2 px-2">
                <button onClick={() => onClose(t.id)}
                  className="px-2 py-0.5 rounded border border-destructive/40 text-destructive text-[10px] font-bold hover:bg-destructive/10 transition-colors">
                  CLOSE
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── HISTORY TAB ───────────────────────────────────────────────────────────────

function HistoryTab({ trades }: { trades: PaperTrade[] }) {
  const closed = trades.filter(t => t.status === "closed");
  const [sortKey, setSortKey] = useState<"pnlPercent" | "exitAt" | "holdDays">("exitAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...closed].sort((a, b) => {
    const av = a[sortKey] as number | string | null ?? 0;
    const bv = b[sortKey] as number | string | null ?? 0;
    const diff = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? diff : -diff;
  });

  function toggleSort(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  }

  const SortTh = ({ label, k }: { label: string; k: typeof sortKey }) => (
    <th className="text-right py-2 px-2 cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort(k)}>
      {label}{sortKey === k && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );

  if (closed.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-xs font-mono text-muted-foreground/40 border border-border/30 rounded-md">
        No closed trades yet
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 px-2">TICKER</th>
            <th className="text-right py-2 px-2">ENTRY</th>
            <th className="text-right py-2 px-2">EXIT</th>
            <SortTh label="P&L %" k="pnlPercent" />
            <th className="text-left py-2 px-2">REASON</th>
            <SortTh label="HOLD" k="holdDays" />
            <th className="text-right py-2 px-2">SCORE</th>
            <SortTh label="DATE" k="exitAt" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(t => (
            <tr key={t.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
              <td className="py-2 px-2">
                <div className="font-bold text-foreground">{t.ticker}</div>
                <div className="text-muted-foreground/50 text-[10px] truncate max-w-[110px]">{t.name}</div>
              </td>
              <td className="text-right py-2 px-2 text-muted-foreground">{formatCurrency(t.entryPrice)}</td>
              <td className="text-right py-2 px-2 text-muted-foreground">{t.exitPrice ? formatCurrency(t.exitPrice) : "—"}</td>
              <td className="text-right py-2 px-2"><PnlBadge pct={t.pnlPercent} dollar={t.pnlDollar} /></td>
              <td className="py-2 px-2"><ExitReasonBadge reason={t.exitReason} /></td>
              <td className="text-right py-2 px-2 text-muted-foreground">{(t.holdDays ?? 0)}d</td>
              <td className="text-right py-2 px-2">
                <span className="inline-flex items-center gap-1">
                  <ScoreChip score={t.entryScore} dim />
                  <span className="text-muted-foreground/40">→</span>
                  <ScoreChip score={t.exitScore} />
                </span>
              </td>
              <td className="text-right py-2 px-2 text-muted-foreground/60">
                {t.exitAt ? new Date(t.exitAt).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── AI BRAIN TAB ──────────────────────────────────────────────────────────────

function SignalTable({ title, groups }: { title: string; groups: SignalGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-muted-foreground/60 text-[10px]">
              <th className="text-left pb-1 pr-3">Signal</th>
              <th className="text-right pb-1 pr-3">Trades</th>
              <th className="text-right pb-1 pr-3">Win %</th>
              <th className="text-right pb-1 pr-3">Avg P&L</th>
              <th className="text-right pb-1">Best</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <tr key={g.label} className="border-t border-border/20">
                <td className="py-1 pr-3 text-foreground/80">{g.label}</td>
                <td className="py-1 pr-3 text-right text-muted-foreground">{g.trades}</td>
                <td className={cn("py-1 pr-3 text-right font-bold", g.winRate >= 55 ? "text-success" : g.winRate >= 45 ? "text-warning" : "text-destructive")}>
                  {g.winRate.toFixed(0)}%
                </td>
                <td className={cn("py-1 pr-3 text-right font-bold", g.avgPnl >= 0 ? "text-success" : "text-destructive")}>
                  {g.avgPnl >= 0 ? "+" : ""}{g.avgPnl.toFixed(2)}%
                </td>
                <td className="py-1 text-right text-success/80">+{g.bestPnl.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiBrainTab({ stats, signalPerformance }: { stats: BotStats | undefined; signalPerformance: SignalPerformance | undefined }) {
  const [analysis, setAnalysis] = useState<string | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: () => apiFetch<{ analysis: string }>("bot/analyze", { method: "POST" }),
    onSuccess: (d) => setAnalysis(d.analysis),
  });

  const StatCard = ({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) => (
    <div className="bg-card border border-border rounded-md p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground/60 text-[10px] font-mono uppercase">
        <Icon className={cn("w-3 h-3", color)} />
        {label}
      </div>
      <div className={cn("text-lg font-mono font-bold", color)}>{value}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Win Rate"    value={`${stats.winRate.toFixed(1)}%`}       icon={Target}       color={stats.winRate >= 55 ? "text-success" : "text-warning"} />
            <StatCard label="Avg P&L"     value={`${stats.avgPnlPct >= 0 ? "+" : ""}${stats.avgPnlPct.toFixed(2)}%`} icon={TrendingUp} color={stats.avgPnlPct >= 0 ? "text-success" : "text-destructive"} />
            <StatCard label="Best Trade"  value={`+${stats.bestTrade.toFixed(2)}%`}     icon={TrendingUp}   color="text-success" />
            <StatCard label="Worst Trade" value={`${stats.worstTrade.toFixed(2)}%`}     icon={TrendingDown} color="text-destructive" />
            <StatCard label="Total Trades" value={String(stats.totalTrades)}            icon={Clock}        color="text-foreground" />
            <StatCard label="Avg Hold"    value={`${stats.avgHoldDays.toFixed(1)}d`}   icon={Clock}        color="text-muted-foreground" />
            <StatCard label="Portfolio"   value={formatCurrency(stats.virtualPortfolioValue)} icon={DollarSign} color={stats.virtualPortfolioValue >= 100000 ? "text-success" : "text-destructive"} />
            <StatCard label="Total P&L"   value={`${stats.totalPnlPct >= 0 ? "+" : ""}${stats.totalPnlPct.toFixed(2)}%`} icon={TrendingUp} color={stats.totalPnlPct >= 0 ? "text-success" : "text-destructive"} />
          </div>

          {signalPerformance && signalPerformance.totalClosed >= 2 && (
            <div className="bg-card border border-primary/20 rounded-md p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono text-primary uppercase tracking-wider font-bold">Signal Performance Learning</div>
                {signalPerformance.bestSignal && (
                  <div className="text-[10px] font-mono text-muted-foreground">
                    Best: <span className="text-success font-bold">{signalPerformance.bestSignal}</span>
                    &nbsp;·&nbsp;Worst: <span className="text-destructive font-bold">{signalPerformance.worstSignal}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SignalTable title="By Entry Score" groups={signalPerformance.byScoreBucket} />
                <SignalTable title="By RSI at Entry" groups={signalPerformance.byRsiRange} />
                <SignalTable title="By Relative Volume" groups={signalPerformance.byRvol} />
                {signalPerformance.byPattern.length > 0 && (
                  <SignalTable title="By Entry Pattern" groups={signalPerformance.byPattern.slice(0, 8)} />
                )}
              </div>
              {signalPerformance.byPattern.length === 0 && (
                <div className="text-[10px] font-mono text-muted-foreground/40 italic">
                  Pattern data accumulates as new trades are opened — add a Pattern filter to your entry criteria to start tracking.
                </div>
              )}
            </div>
          )}

        {Object.keys(stats.byExitReason).length > 0 && (
            <div className="bg-card border border-border rounded-md p-3">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Exit Reason Breakdown</div>
              <div className="flex flex-wrap gap-3">
                {Object.entries(stats.byExitReason).map(([reason, data]) => (
                  <div key={reason} className="flex items-center gap-2 text-xs font-mono">
                    <ExitReasonBadge reason={reason} />
                    <span className="text-muted-foreground">{data.count} trades</span>
                    <PnlBadge pct={data.avgPnl} />
                    <span className="text-muted-foreground/40">avg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="bg-card border border-violet-700/30 rounded-md p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-mono text-violet-400 uppercase tracking-wider font-bold">Claude AI Analysis</span>
          </div>
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors",
              analyzeMutation.isPending
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-violet-700 text-white hover:bg-violet-600"
            )}>
            <Zap className="w-3 h-3" />
            {analyzeMutation.isPending ? "ANALYZING…" : "ANALYZE NOW"}
          </button>
        </div>

        {analyzeMutation.isError && (
          <div className="flex items-center gap-2 text-xs font-mono text-destructive bg-destructive/10 rounded p-2">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Analysis failed. Ensure you have closed trades to analyze.
          </div>
        )}

        {analysis ? (
          <div className="text-sm font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed bg-background/50 rounded p-3 border border-border/40 max-h-[500px] overflow-y-auto">
            {analysis}
          </div>
        ) : (
          <div className="text-xs font-mono text-muted-foreground/40 italic py-4 text-center">
            {(stats?.closedTrades ?? 0) === 0
              ? "Run the bot through a few cycles to generate trades, then analyze performance."
              : "Click ANALYZE NOW to get Claude's assessment of the bot's performance and improvement suggestions."}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BotLab() {
  const qc = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery<BotConfig>({
    queryKey: ["bot-config"],
    queryFn:  () => apiFetch("bot/config"),
  });

  const { data: status, refetch: refetchStatus } = useQuery<BotStatus>({
    queryKey:       ["bot-status"],
    queryFn:        () => apiFetch("bot/status"),
    refetchInterval: 15000,
  });

  const { data: trades = [], refetch: refetchTrades } = useQuery<PaperTrade[]>({
    queryKey:       ["bot-trades"],
    queryFn:        () => apiFetch("bot/trades?status=all"),
    refetchInterval: 30000,
  });

  const { data: stats } = useQuery<BotStats>({
    queryKey:       ["bot-stats"],
    queryFn:        () => apiFetch("bot/stats"),
    refetchInterval: 30000,
  });

  const { data: signalPerformance } = useQuery<SignalPerformance>({
    queryKey:       ["bot-signal-performance"],
    queryFn:        () => apiFetch("bot/signal-performance"),
    refetchInterval: 60000,
  });

  const toggleEnabled = useMutation({
    mutationFn: () => apiFetch<BotConfig>("bot/config", {
      method: "PUT",
      body:   JSON.stringify({ enabled: !config?.enabled }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-config"] });
      qc.invalidateQueries({ queryKey: ["bot-status"] });
    },
  });

  const runCycleMutation = useMutation({
    mutationFn: () => apiFetch<{ exited: string[]; newEntries: string[]; openCount: number }>("bot/run", { method: "POST" }),
    onSuccess: () => {
      refetchStatus();
      refetchTrades();
      qc.invalidateQueries({ queryKey: ["bot-stats"] });
    },
  });

  const closeTradeMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`bot/trades/${id}/close`, { method: "POST", body: "{}" }),
    onSuccess:  () => { refetchTrades(); qc.invalidateQueries({ queryKey: ["bot-stats"] }); },
  });

  const openCount   = trades.filter(t => t.status === "open").length;
  const closedCount = trades.filter(t => t.status === "closed").length;

  const lastRunText = status?.lastRunAt
    ? (() => {
        const ageMs  = Date.now() - new Date(status.lastRunAt).getTime();
        const ageMin = Math.floor(ageMs / 60000);
        return ageMin < 1 ? "just now" : `${ageMin}m ago`;
      })()
    : "never";

  if (configLoading) {
    return <div className="flex-1 flex items-center justify-center text-xs font-mono text-muted-foreground">Loading bot…</div>;
  }

  return (
    <div className="flex-1 p-6 overflow-hidden flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display tracking-widest text-primary">ATLAS BOT</h1>
            <span className={cn(
              "px-2 py-0.5 rounded text-xs font-mono font-bold border",
              config?.enabled
                ? "bg-success/15 text-success border-success/30"
                : "bg-muted/40 text-muted-foreground border-border"
            )}>
              {config?.enabled ? "● ENABLED" : "○ DISABLED"}
            </span>
            {status?.cycleRunning && (
              <span className="text-xs font-mono text-warning animate-pulse">● CYCLE RUNNING…</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs font-mono text-muted-foreground">
            <span>Last run: <span className="text-foreground">{lastRunText}</span></span>
            <span>Portfolio: <span className={cn(
              (status?.virtualPortfolioValue ?? 100000) >= 100000 ? "text-success" : "text-destructive"
            )}>{formatCurrency(status?.virtualPortfolioValue ?? config?.virtualPortfolio ?? 100000)}</span></span>
            <span><span className="text-foreground">{openCount}</span> open · <span className="text-foreground">{closedCount}</span> closed</span>
            {(stats?.closedTrades ?? 0) > 0 && (
              <span>Win rate: <span className={stats!.winRate >= 55 ? "text-success" : "text-warning"}>{stats!.winRate.toFixed(1)}%</span></span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runCycleMutation.mutate()}
            disabled={runCycleMutation.isPending || status?.cycleRunning}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded font-mono text-xs font-bold tracking-wider transition-colors",
              (runCycleMutation.isPending || status?.cycleRunning)
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}>
            <Play className="w-3 h-3" />
            {runCycleMutation.isPending ? "RUNNING…" : "RUN CYCLE"}
          </button>
          <button
            onClick={() => toggleEnabled.mutate()}
            disabled={toggleEnabled.isPending}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded font-mono text-xs font-bold border transition-colors",
              config?.enabled
                ? "border-warning/40 text-warning hover:bg-warning/10"
                : "border-success/40 text-success hover:bg-success/10"
            )}>
            {config?.enabled ? <><Pause className="w-3 h-3" /> PAUSE</> : <><Play className="w-3 h-3" /> ENABLE</>}
          </button>
        </div>
      </div>

      {/* Run result flash */}
      {runCycleMutation.isSuccess && runCycleMutation.data && (() => {
        const d = runCycleMutation.data as { exited: string[]; newEntries: string[]; openCount: number; skipped?: boolean; reason?: string };
        if (d.skipped) return (
          <div className="text-xs font-mono bg-muted/30 border border-border rounded px-3 py-2 text-muted-foreground">
            Cycle skipped: {d.reason}
          </div>
        );
        return (
          <div className="text-xs font-mono bg-card border border-success/30 rounded px-3 py-2 flex gap-4">
            <span className="text-success">✓ Cycle complete</span>
            {d.newEntries.length > 0 && <span>Opened: <span className="text-success">{d.newEntries.join(", ")}</span></span>}
            {d.exited.length > 0 && <span>Exited: <span className="text-warning">{d.exited.join(", ")}</span></span>}
            <span className="text-muted-foreground">{d.openCount} positions open</span>
          </div>
        );
      })()}

      {/* Tabs */}
      <Tabs defaultValue="config" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card border border-border w-full justify-start h-auto flex-wrap p-1 gap-1">
          <TabsTrigger value="config"    className="font-mono text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">CONFIG</TabsTrigger>
          <TabsTrigger value="positions" className="font-mono text-xs data-[state=active]:bg-success data-[state=active]:text-success-foreground">
            POSITIONS {openCount > 0 && <span className="ml-1 bg-success/20 text-success rounded-full px-1.5 text-[10px]">{openCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="history"   className="font-mono text-xs data-[state=active]:bg-muted-foreground data-[state=active]:text-background">
            HISTORY {closedCount > 0 && <span className="ml-1 opacity-70">({closedCount})</span>}
          </TabsTrigger>
          <TabsTrigger value="ai-brain"  className="font-mono text-xs data-[state=active]:bg-violet-700 data-[state=active]:text-white">
            ✦ AI BRAIN
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto mt-4">
          <TabsContent value="config"    className="m-0">
            {config && <ConfigTab config={config} onSaved={() => { refetchStatus(); }} />}
          </TabsContent>
          <TabsContent value="positions" className="m-0">
            <PositionsTab trades={trades} onClose={(id) => closeTradeMutation.mutate(id)} />
          </TabsContent>
          <TabsContent value="history"   className="m-0">
            <HistoryTab trades={trades} />
          </TabsContent>
          <TabsContent value="ai-brain"  className="m-0">
            <AiBrainTab stats={stats} signalPerformance={signalPerformance} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
