import { useState, useCallback, useRef, useMemo } from "react";
import { FlaskConical, ChevronUp, ChevronDown, ChevronsUpDown, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, XCircle, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatIC   { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number; }
interface Weights { trend: number; momentum: number; volume: number; relativeStrength: number; regime: number; }

interface BacktestResult {
  ticker: string; horizon: number;
  marketCap: number | null; marketCapBucket: string; marketCapNote: string;
  ic: number; icRating: string;
  rankIC: number; rankICRating: string; icTStat: number;
  totalObservations: number;
  calibratedSlope: number; calibratedIntercept: number;
  categoryIC: CatIC; optimalWeights: Weights | null; currentWeights: Weights;
  bull: { count: number; hitRate: number | null; avgReturn: number | null };
  neutral: { count: number; hitRate: number | null; avgReturn: number | null };
  bear: { count: number; hitRate: number | null; avgReturn: number | null };
  deciles: Array<{ bucket: string; count: number; hitRate: number | null; avgReturn: number | null }>;
  scatter: Array<{ x: number; y: number; date: string }>;
  timeline: Array<{ date: string; score: number; fwdReturn: number; direction: "bull" | "neutral" | "bear"; correct: boolean }>;
  cachedAt: string;
}

interface MultiHorizon {
  horizon: number; rankIC: number; rankICRating: string; icTStat: number;
  categoryIC: CatIC; optimalWeights: Weights | null; totalObservations: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HORIZONS = [1, 5, 10, 20] as const;
const CAT_LABELS: Array<[keyof CatIC, string]> = [
  ["relativeStrength", "REL STR"], ["trend", "TREND"], ["momentum", "MOM"],
  ["volume", "VOLUME"], ["regime", "REGIME"],
];
const WEIGHT_LABELS: Array<[keyof Weights, string]> = [
  ["trend", "TREND"], ["momentum", "MOM"], ["volume", "VOLUME"],
  ["relativeStrength", "REL STR"], ["regime", "REGIME"],
];
const PAGE_SIZE = 30;

function icColor(v: number) {
  if (v >= 0.10) return "text-emerald-400";
  if (v >= 0.05) return "text-amber-400";
  if (v >= 0.02) return "text-muted-foreground";
  if (v > -0.02) return "text-muted-foreground";
  if (v > -0.05) return "text-amber-400";
  return "text-red-400";
}

function icBgColor(v: number) {
  if (v >= 0.10) return "bg-emerald-500/20";
  if (v >= 0.05) return "bg-amber-500/15";
  if (v > -0.05) return "bg-zinc-700/20";
  return "bg-red-500/20";
}

function hitColor(rate: number | null) {
  if (rate === null) return "text-muted-foreground";
  if (rate >= 65) return "text-emerald-400";
  if (rate >= 55) return "text-amber-400";
  if (rate >= 45) return "text-muted-foreground";
  return "text-red-400";
}

function retColor(r: number | null) {
  if (r === null) return "text-muted-foreground";
  if (r > 2) return "text-emerald-400";
  if (r > 0) return "text-emerald-400/70";
  if (r > -2) return "text-red-400/70";
  return "text-red-400";
}

function fmtRet(v: number | null) { return v === null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }

// ── IC Horizon Bar ─────────────────────────────────────────────────────────────

function HorizonBar({ data }: { data: MultiHorizon[] }) {
  const max = Math.max(...data.map(d => Math.abs(d.rankIC)), 0.01);
  return (
    <div className="space-y-1.5">
      {data.map(d => {
        const pct = Math.abs(d.rankIC) / max * 100;
        const pos = d.rankIC >= 0;
        return (
          <div key={d.horizon} className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground w-5">{d.horizon}D</span>
            <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden relative">
              <div
                className={cn("h-full rounded transition-all", pos ? "bg-emerald-500/40" : "bg-red-500/40")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn("text-xs font-mono w-14 text-right", icColor(d.rankIC))}>
              {d.rankIC >= 0 ? "+" : ""}{d.rankIC.toFixed(3)}
            </span>
            <span className="text-xs font-mono text-muted-foreground w-20">
              {d.rankICRating} {d.icTStat !== 0 ? `t=${d.icTStat.toFixed(2)}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Category IC Bars ──────────────────────────────────────────────────────────

function CatICBars({ catIC }: { catIC: CatIC }) {
  const vals = CAT_LABELS.map(([k, lbl]) => ({ key: k, lbl, v: catIC[k] }));
  const max = Math.max(...vals.map(d => Math.abs(d.v)), 0.01);
  return (
    <div className="space-y-1.5">
      {vals.map(({ key, lbl, v }) => {
        const pct = Math.abs(v) / max * 100;
        const pos = v >= 0;
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground w-14">{lbl}</span>
            <div className="flex-1 h-3.5 bg-zinc-800 rounded overflow-hidden">
              <div
                className={cn("h-full rounded", pos ? "bg-emerald-500/50" : "bg-red-500/50")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={cn("text-xs font-mono w-12 text-right", icColor(v))}>
              {v >= 0 ? "+" : ""}{v.toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Weight Comparison ─────────────────────────────────────────────────────────

function WeightTable({ current, optimal }: { current: Weights; optimal: Weights | null }) {
  return (
    <table className="w-full text-xs font-mono">
      <thead>
        <tr className="text-muted-foreground border-b border-border">
          <th className="text-left pb-1">FACTOR</th>
          <th className="text-right pb-1">CURRENT</th>
          <th className="text-right pb-1">OPTIMAL</th>
          <th className="text-right pb-1">DELTA</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/30">
        {WEIGHT_LABELS.map(([k, lbl]) => {
          const cur = current[k];
          const opt = optimal?.[k] ?? null;
          const delta = opt !== null ? opt - cur : null;
          return (
            <tr key={k} className="text-xs">
              <td className="py-1 text-muted-foreground">{lbl}</td>
              <td className="py-1 text-right">{cur}%</td>
              <td className="py-1 text-right">{opt !== null ? opt + "%" : "—"}</td>
              <td className={cn("py-1 text-right font-semibold",
                delta === null ? "text-muted-foreground"
                  : delta > 3 ? "text-emerald-400"
                  : delta < -3 ? "text-red-400"
                  : "text-muted-foreground"
              )}>
                {delta === null ? "—" : (delta > 0 ? "+" : "") + delta + "%"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Decile Table ──────────────────────────────────────────────────────────────

function DecileTable({ deciles, rankIC }: { deciles: BacktestResult["deciles"]; rankIC: number }) {
  const contrarian = rankIC < 0;
  return (
    <div>
      {contrarian && (
        <div className="mb-2 text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
          ⚠ CONTRARIAN: Negative IC — interpret score buckets inversely (low score = bullish signal)
        </div>
      )}
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            <th className="text-left pb-1">SCORE BUCKET</th>
            <th className="text-right pb-1">N</th>
            <th className="text-right pb-1">HIT%</th>
            <th className="text-right pb-1">AVG RET</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {deciles.filter(d => d.count > 0).map(d => (
            <tr key={d.bucket}>
              <td className="py-1 text-muted-foreground">{d.bucket}</td>
              <td className="py-1 text-right">{d.count}</td>
              <td className={cn("py-1 text-right font-semibold", hitColor(d.hitRate))}>
                {d.hitRate !== null ? d.hitRate + "%" : "—"}
              </td>
              <td className={cn("py-1 text-right", retColor(d.avgReturn))}>
                {fmtRet(d.avgReturn)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Scatter Plot ──────────────────────────────────────────────────────────────

function ScatterPlot({ data }: { data: BacktestResult["scatter"] }) {
  if (!data.length) return null;
  const pad = { t: 10, r: 10, b: 28, l: 36 };
  const W = 300 - pad.l - pad.r; const H = 140 - pad.t - pad.b;
  const xs = data.map(d => d.x); const ys = data.map(d => d.y);
  const xMin = Math.min(...xs); const xMax = Math.max(...xs);
  const yMin = Math.min(...ys); const yMax = Math.max(...ys);
  const toX = (v: number) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * W;
  const toY = (v: number) => pad.t + H - ((v - yMin) / (yMax - yMin || 1)) * H;
  const zero = toY(0);
  const n = data.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  return (
    <svg width={300} height={140} className="overflow-visible">
      {zero > pad.t && zero < pad.t + H && (
        <line x1={pad.l} x2={pad.l + W} y1={zero} y2={zero}
          stroke="rgba(255,255,255,0.15)" strokeDasharray="3,3" />
      )}
      <line x1={toX(xMin)} y1={toY(slope * xMin + intercept)}
        x2={toX(xMax)} y2={toY(slope * xMax + intercept)}
        stroke={slope > 0 ? "rgba(52,211,153,0.7)" : "rgba(248,113,113,0.7)"}
        strokeWidth={1.5} />
      {data.map((d, i) => (
        <circle key={i} cx={toX(d.x)} cy={toY(d.y)} r={2}
          fill={d.y > 0 ? "rgba(52,211,153,0.45)" : "rgba(248,113,113,0.45)"} />
      ))}
      <text x={pad.l} y={140 - 6} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace">Score →</text>
      <text x={pad.l - 4} y={pad.t + 6} fontSize={9} fill="rgba(255,255,255,0.35)" fontFamily="monospace" textAnchor="end">Ret%</text>
      <text x={pad.l} y={zero - 3} fontSize={8} fill="rgba(255,255,255,0.25)" fontFamily="monospace">0</text>
    </svg>
  );
}

// ── Timeline Table ────────────────────────────────────────────────────────────

type SortKey = "date" | "score" | "fwdReturn";
type SortDir = "asc" | "desc";

function TimelineTable({ data, horizon, rankIC }: {
  data: BacktestResult["timeline"]; horizon: number; rankIC: number;
}) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState<"all" | "correct" | "wrong">("all");

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
    setPage(0);
  };

  const filtered = useMemo(() => {
    let d = [...data];
    if (filter === "correct") d = d.filter(r => r.correct);
    if (filter === "wrong") d = d.filter(r => !r.correct);
    d.sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "date") return mul * a.date.localeCompare(b.date);
      if (sortKey === "score") return mul * (a.score - b.score);
      return mul * (a.fwdReturn - b.fwdReturn);
    });
    return d;
  }, [data, filter, sortKey, sortDir]);

  const pages = Math.ceil(filtered.length / PAGE_SIZE);
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const correctCount = data.filter(r => r.correct).length;
  const accuracy = data.length ? Math.round(correctCount / data.length * 100) : 0;

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => handleSort(k)}
      className="flex items-center gap-1 hover:text-foreground transition-colors">
      {label}
      {sortKey === k
        ? sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );

  const contrarian = rankIC < 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">{filtered.length} bars</span>
          <span className={cn("text-xs font-mono font-semibold px-2 py-0.5 rounded",
            accuracy >= 60 ? "bg-emerald-500/20 text-emerald-400" :
            accuracy >= 50 ? "bg-amber-500/20 text-amber-400" :
            "bg-red-500/20 text-red-400"
          )}>
            {accuracy}% correct direction
          </span>
          {contrarian && (
            <span className="text-xs font-mono text-amber-400">
              (inverted: high score → bearish signal)
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["all", "correct", "wrong"] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(0); }}
              className={cn("px-2 py-0.5 text-xs font-mono border rounded transition-colors",
                filter === f
                  ? f === "correct" ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                    : f === "wrong" ? "border-red-500 text-red-400 bg-red-500/10"
                    : "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:border-foreground"
              )}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-muted-foreground border-b border-border bg-zinc-900/50">
              <th className="text-left py-2 px-3"><SortBtn k="date" label="DATE" /></th>
              <th className="text-right py-2 px-3"><SortBtn k="score" label="SCORE" /></th>
              <th className="text-center py-2 px-3">SIGNAL</th>
              <th className="text-right py-2 px-3"><SortBtn k="fwdReturn" label={`${horizon}D RET`} /></th>
              <th className="text-center py-2 px-3">RESULT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {rows.map((row) => {
              const dir = contrarian
                ? row.direction === "bull" ? "bear" : row.direction === "bear" ? "bull" : "neutral"
                : row.direction;
              return (
                <tr key={row.date} className={cn("hover:bg-zinc-800/40 transition-colors",
                  !row.correct && "bg-red-950/10"
                )}>
                  <td className="py-1.5 px-3 text-muted-foreground">{row.date}</td>
                  <td className="py-1.5 px-3 text-right">
                    <span className={cn("font-semibold",
                      row.score >= 70 ? "text-emerald-400" :
                      row.score >= 60 ? "text-emerald-400/70" :
                      row.score <= 30 ? "text-red-400" :
                      row.score <= 40 ? "text-red-400/70" :
                      "text-muted-foreground"
                    )}>{row.score}</span>
                  </td>
                  <td className="py-1.5 px-3 text-center">
                    <span className={cn("text-xs px-1.5 py-0.5 rounded",
                      dir === "bull" ? "bg-emerald-500/15 text-emerald-400" :
                      dir === "bear" ? "bg-red-500/15 text-red-400" :
                      "bg-zinc-700/40 text-muted-foreground"
                    )}>
                      {dir.toUpperCase()}
                    </span>
                  </td>
                  <td className={cn("py-1.5 px-3 text-right font-semibold", retColor(row.fwdReturn))}>
                    {fmtRet(row.fwdReturn)}
                  </td>
                  <td className="py-1.5 px-3 text-center">
                    {row.correct
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                      : <XCircle className="w-3.5 h-3.5 text-red-500/70 mx-auto" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-xs font-mono">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-2 py-1 border border-border rounded disabled:opacity-30 hover:border-foreground transition-colors">
            ← PREV
          </button>
          <span className="text-muted-foreground">
            {page + 1} / {pages} ({filtered.length} rows)
          </span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="px-2 py-1 border border-border rounded disabled:opacity-30 hover:border-foreground transition-colors">
            NEXT →
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BacktestLab() {
  const [tickerInput, setTickerInput] = useState("HOOD");
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(10);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [multiData, setMultiData] = useState<MultiHorizon[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (ticker: string, h: number) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true); setError(null);
    try {
      const [mainRes, multiRes] = await Promise.all([
        fetch(`/api/backtest/ic?ticker=${encodeURIComponent(ticker)}&horizon=${h}`, { signal: ctrl.signal }),
        fetch(`/api/backtest/multi?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal }),
      ]);
      if (!mainRes.ok) { const e = await mainRes.json(); throw new Error(e.error ?? `HTTP ${mainRes.status}`); }
      const main: BacktestResult = await mainRes.json();
      setResult(main);
      if (multiRes.ok) {
        const multi = await multiRes.json();
        setMultiData(multi.horizons);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRun = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) run(t, horizon);
  };

  const contrarian = result && result.rankIC < 0;
  const signalValid = result && Math.abs(result.icTStat) >= 1.65;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card/30">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <FlaskConical className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold tracking-wider font-mono">BACKTEST LAB</h1>
            <span className="text-xs text-muted-foreground font-mono">2Y walk-forward · candle-by-candle IC analysis</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleRun()}
              placeholder="TICKER"
              className="w-28 px-3 py-1.5 text-sm font-mono bg-background border border-border rounded focus:outline-none focus:border-primary uppercase"
            />
            <div className="flex gap-1">
              {HORIZONS.map(h => (
                <button key={h} onClick={() => setHorizon(h)}
                  className={cn("px-2.5 py-1 text-xs font-mono border rounded transition-colors",
                    horizon === h
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:border-foreground"
                  )}>{h}D</button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground font-mono">forward horizon</span>
            <button
              onClick={handleRun}
              disabled={loading}
              className="px-4 py-1.5 text-xs font-mono font-bold bg-primary text-primary-foreground rounded hover:bg-primary/80 disabled:opacity-50 transition-colors"
            >
              {loading ? "COMPUTING…" : "RUN BACKTEST"}
            </button>
            {loading && (
              <span className="text-xs text-muted-foreground font-mono animate-pulse">
                ~20–40s for 2Y of data…
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-xs font-mono text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="px-6 py-4 space-y-6">

          {/* ── Signal Quality Header ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={cn("p-3 rounded border", icBgColor(result.rankIC), "border-border")}>
              <div className="text-xs text-muted-foreground font-mono mb-1">RANK IC ({result.horizon}D)</div>
              <div className={cn("text-2xl font-bold font-mono", icColor(result.rankIC))}>
                {result.rankIC >= 0 ? "+" : ""}{result.rankIC.toFixed(3)}
              </div>
              <div className="text-xs font-mono mt-1">
                <span className={icColor(result.rankIC)}>{result.rankICRating.toUpperCase()}</span>
              </div>
            </div>
            <div className="p-3 rounded border border-border bg-card/30">
              <div className="text-xs text-muted-foreground font-mono mb-1">t-STATISTIC</div>
              <div className={cn("text-2xl font-bold font-mono",
                Math.abs(result.icTStat) >= 2 ? "text-emerald-400" :
                Math.abs(result.icTStat) >= 1.65 ? "text-amber-400" : "text-red-400"
              )}>
                {result.icTStat.toFixed(2)}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-1">
                {Math.abs(result.icTStat) >= 2 ? "95% confidence" :
                  Math.abs(result.icTStat) >= 1.65 ? "90% confidence" : "not significant"}
              </div>
            </div>
            <div className="p-3 rounded border border-border bg-card/30">
              <div className="text-xs text-muted-foreground font-mono mb-1">OBSERVATIONS</div>
              <div className="text-2xl font-bold font-mono">{result.totalObservations}</div>
              <div className="text-xs font-mono text-muted-foreground mt-1">~2Y daily bars</div>
            </div>
            <div className={cn("p-3 rounded border",
              contrarian ? "bg-amber-500/10 border-amber-500/30" :
              signalValid ? "bg-emerald-500/10 border-emerald-500/30" :
              "bg-zinc-800/30 border-border"
            )}>
              <div className="text-xs text-muted-foreground font-mono mb-1">SIGNAL MODE</div>
              <div className={cn("text-sm font-bold font-mono",
                contrarian ? "text-amber-400" :
                signalValid ? "text-emerald-400" : "text-muted-foreground"
              )}>
                {contrarian ? "CONTRARIAN" : signalValid ? "MOMENTUM" : "NOISE"}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-1">
                {result.marketCapBucket.toUpperCase()} CAP
              </div>
              {contrarian && (
                <div className="text-xs font-mono text-amber-400 mt-1">
                  High score → bearish signal
                </div>
              )}
            </div>
          </div>

          {contrarian && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-xs font-mono text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>{result.ticker}</strong> shows negative IC ({result.rankIC.toFixed(3)}) across this horizon — the Atlas Score acts as a <strong>contrarian indicator</strong> for this stock.
                High scores precede underperformance; low scores precede outperformance. {result.marketCapNote}
              </span>
            </div>
          )}

          {/* ── Horizon Progression + Score Buckets ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {multiData && (
              <div className="p-4 bg-card/30 border border-border rounded space-y-3">
                <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                  IC BY HORIZON — signal strengthens with time
                </div>
                <HorizonBar data={multiData} />
                <div className="text-xs text-muted-foreground font-mono">
                  Score predicts {Math.abs(multiData[multiData.length - 1]?.rankIC ?? 0) > Math.abs(multiData[0]?.rankIC ?? 0) ? "longer" : "shorter"} holding periods better
                </div>
              </div>
            )}
            <div className="p-4 bg-card/30 border border-border rounded space-y-3">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                SCORE BUCKET PERFORMANCE
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "BULL (≥60)", data: result.bull, color: "emerald" },
                  { label: "NEUTRAL", data: result.neutral, color: "zinc" },
                  { label: "BEAR (≤40)", data: result.bear, color: "red" },
                ].map(({ label, data, color }) => (
                  <div key={label} className={cn("p-2 rounded border text-center",
                    color === "emerald" ? "border-emerald-500/30 bg-emerald-500/5" :
                    color === "red" ? "border-red-500/30 bg-red-500/5" :
                    "border-border bg-zinc-800/20"
                  )}>
                    <div className="text-xs font-mono text-muted-foreground mb-1">{label}</div>
                    <div className={cn("text-lg font-bold font-mono",
                      color === "emerald" ? "text-emerald-400" :
                      color === "red" ? "text-red-400" : "text-muted-foreground"
                    )}>
                      {data.hitRate !== null ? data.hitRate + "%" : "—"}
                    </div>
                    <div className={cn("text-xs font-mono", retColor(data.avgReturn))}>
                      {fmtRet(data.avgReturn)}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">n={data.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Category IC + Weights ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 bg-card/30 border border-border rounded space-y-3">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                FACTOR IC — which signals are actually predicting returns
              </div>
              <CatICBars catIC={result.categoryIC} />
              <div className="text-xs text-muted-foreground font-mono">
                Positive IC = factor is predictive. Negative = factor is contrarian or noise for this ticker.
              </div>
            </div>
            <div className="p-4 bg-card/30 border border-border rounded space-y-3">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                WEIGHT OPTIMIZATION — IC²-proportional
              </div>
              <WeightTable current={result.currentWeights} optimal={result.optimalWeights} />
              <div className="text-xs text-muted-foreground font-mono">
                Optimal weights derived from IC²-proportional allocation — factors with higher IC get more weight.
                Applied globally in scoring engine based on cross-sectional IC analysis.
              </div>
            </div>
          </div>

          {/* ── Decile Table + Scatter ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 bg-card/30 border border-border rounded space-y-3">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                SCORE DECILE TABLE — hit rate and avg return by score range
              </div>
              <DecileTable deciles={result.deciles} rankIC={result.rankIC} />
            </div>
            <div className="p-4 bg-card/30 border border-border rounded space-y-3">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider">
                SCORE vs {result.horizon}D FORWARD RETURN (scatter)
              </div>
              <ScatterPlot data={result.scatter} />
              <div className="text-xs text-muted-foreground font-mono">
                Regression slope: {result.ic >= 0 ? "+" : ""}{result.ic.toFixed(3)} ·
                Each dot = 1 trading day (sampled)
              </div>
              {/* Calibrated probability note */}
              <div className="pt-2 border-t border-border text-xs font-mono space-y-1">
                <div className="text-muted-foreground font-bold">CALIBRATED PROBABILITY CURVE</div>
                <div className="text-muted-foreground">
                  P(+return) = sigmoid({result.calibratedSlope.toFixed(3)} · score {result.calibratedIntercept >= 0 ? "+" : ""}{result.calibratedIntercept.toFixed(3)})
                </div>
                <div className="grid grid-cols-3 gap-1 mt-1">
                  {[30, 50, 70].map(s => {
                    const z = Math.max(-15, Math.min(15, result.calibratedSlope * s + result.calibratedIntercept));
                    const p = Math.round((1 / (1 + Math.exp(-z))) * 100);
                    return (
                      <div key={s} className="text-center border border-border rounded p-1">
                        <div className="text-muted-foreground text-xs">Score {s}</div>
                        <div className={cn("font-bold", p >= 55 ? "text-emerald-400" : p >= 45 ? "text-muted-foreground" : "text-red-400")}>
                          {p}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Candle Timeline ── */}
          <div className="p-4 bg-card/30 border border-border rounded space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-mono font-bold text-muted-foreground tracking-wider flex items-center gap-2">
                <ArrowUpDown className="w-3.5 h-3.5" />
                CANDLE TIMELINE — every bar · score vs {result.horizon}D actual return
              </div>
            </div>
            <TimelineTable data={result.timeline} horizon={result.horizon} rankIC={result.rankIC} />
          </div>

        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground font-mono space-y-3">
          <FlaskConical className="w-10 h-10 opacity-20" />
          <div className="text-sm">Enter a ticker and run the backtest to begin</div>
          <div className="text-xs opacity-60">
            Scores every daily bar over 2 years · measures forward return prediction accuracy
          </div>
        </div>
      )}
    </div>
  );
}
