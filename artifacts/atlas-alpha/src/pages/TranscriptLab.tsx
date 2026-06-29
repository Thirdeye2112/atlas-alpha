import { useState, useEffect, useCallback } from "react";
import { FileText, Play, RotateCcw, Trash2, ExternalLink, ChevronDown, ChevronUp, RefreshCw, Clock, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = "all" | "indicator" | "rule" | "setup" | "market_call" | "risk";
type View = "insights" | "history";

interface Insight {
  category: Exclude<Category, "all">;
  text: string;
  confidence: "high" | "medium" | "low";
  tickers: string[];
  videoTitle: string;
  videoUrl: string;
  processedAt: string;
}

interface VideoHistory {
  videoTitle: string;
  videoUrl: string;
  rawSummary: string;
  tokenCount: number;
  processedAt: string;
  insightCount: number;
  insights: Omit<Insight, "videoTitle" | "videoUrl" | "processedAt">[];
}

interface Status {
  filePath: string;
  fileExists: boolean;
  totalVideos: number;
  processed: number;
  totalInsights: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: "all",         label: "All",          color: "text-foreground" },
  { key: "indicator",   label: "Indicators",   color: "text-primary" },
  { key: "rule",        label: "Rules",        color: "text-emerald-400" },
  { key: "setup",       label: "Setups",       color: "text-orange-400" },
  { key: "market_call", label: "Market Calls", color: "text-violet-400" },
  { key: "risk",        label: "Risk Mgmt",    color: "text-rose-400" },
];

const CONF_COLORS: Record<string, string> = {
  high:   "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  medium: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  low:    "text-muted-foreground border-border bg-muted/20",
};

const CAT_COLORS: Record<string, string> = {
  indicator:   "text-primary border-primary/30 bg-primary/10",
  rule:        "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  setup:       "text-orange-400 border-orange-400/30 bg-orange-400/10",
  market_call: "text-violet-400 border-violet-400/30 bg-violet-400/10",
  risk:        "text-rose-400 border-rose-400/30 bg-rose-400/10",
};

// ── Components ────────────────────────────────────────────────────────────────

function StatusBar({ status, onRun, onReset, running }: {
  status: Status | null;
  onRun: (limit: number) => void;
  onReset: () => void;
  running: boolean;
}) {
  const [batchSize, setBatchSize] = useState(20);
  const pct = status && status.totalVideos > 0
    ? Math.round((status.processed / status.totalVideos) * 100) : 0;

  const isDisabled = running || !status?.fileExists;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="font-mono text-sm font-semibold text-primary">TRANSCRIPT ANALYSIS ENGINE</span>
          </div>
          {status && (
            <p className="text-xs text-muted-foreground font-mono truncate max-w-lg" title={status.filePath}>
              {status.fileExists ? `📂 ${status.filePath}` : `⚠ File not found: ${status.filePath}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={batchSize}
            onChange={e => setBatchSize(Number(e.target.value))}
            disabled={running}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground"
          >
            {[10, 20, 50].map(n => <option key={n} value={n}>{n} videos</option>)}
          </select>
          <button
            onClick={() => onRun(batchSize)}
            disabled={isDisabled}
            title={!status?.fileExists ? "Transcript file not found — check the path shown above" : undefined}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors",
              isDisabled
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                : "bg-primary text-primary-foreground hover:bg-primary/80"
            )}
          >
            {running ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {running ? "Processing…" : "Run Analysis"}
          </button>
          <button
            onClick={onReset}
            disabled={running}
            title="Clear all extracted insights"
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-border"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {status && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-muted-foreground">
              {status.processed.toLocaleString()} / {status.totalVideos.toLocaleString()} videos analyzed
              &nbsp;·&nbsp;
              <span className="text-primary font-semibold">{status.totalInsights.toLocaleString()} insights extracted</span>
            </span>
            <span className={cn("font-semibold", pct === 100 ? "text-emerald-400" : "text-yellow-400")}>{pct}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniInsight({ ins }: { ins: Omit<Insight, "videoTitle" | "videoUrl" | "processedAt"> }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
      <div className="flex gap-1 shrink-0 mt-0.5">
        <span className={cn("text-[9px] font-mono font-semibold px-1 py-0.5 rounded border uppercase", CAT_COLORS[ins.category])}>
          {ins.category.replace("_", " ")}
        </span>
        <span className={cn("text-[9px] font-mono px-1 py-0.5 rounded border uppercase", CONF_COLORS[ins.confidence])}>
          {ins.confidence}
        </span>
      </div>
      <p className="text-xs text-foreground leading-snug flex-1">{ins.text}</p>
      {ins.tickers.length > 0 && (
        <div className="flex gap-1 shrink-0">
          {ins.tickers.slice(0, 3).map(t => (
            <span key={t} className="text-[9px] font-mono font-semibold text-primary bg-primary/10 px-1 py-0.5 rounded">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoHistoryCard({ video }: { video: VideoHistory }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(video.processedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(x => !x)}
        className="w-full flex items-start justify-between gap-3 p-3 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">{video.videoTitle}</span>
          </div>
          {video.rawSummary && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{video.rawSummary}</p>
          )}
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span className="text-primary font-semibold">{video.insightCount} insights</span>
            <span>·</span>
            <span>{date}</span>
            <span>·</span>
            <span>{video.tokenCount.toLocaleString()} tokens</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <a
            href={video.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-primary hover:text-primary/80"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && video.insights.length > 0 && (
        <div className="px-3 pb-3 border-t border-border/50">
          <div className="mt-2 space-y-0">
            {video.insights.map((ins, i) => (
              <MiniInsight key={i} ins={ins} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(insight.processedAt).toLocaleDateString();

  return (
    <div className="bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-sm text-foreground leading-snug">{insight.text}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border uppercase", CAT_COLORS[insight.category])}>
              {insight.category.replace("_", " ")}
            </span>
            <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase", CONF_COLORS[insight.confidence])}>
              {insight.confidence}
            </span>
            {insight.tickers.map(t => (
              <span key={t} className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{t}</span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setExpanded(x => !x)}
          className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground truncate">{insight.videoTitle} · {date}</span>
          <a
            href={insight.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Watch <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TranscriptLab() {
  const [status,   setStatus]   = useState<Status | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [total,    setTotal]    = useState(0);
  const [history,  setHistory]  = useState<VideoHistory[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage,  setHistoryPage]  = useState(1);
  const [view,     setView]     = useState<View>("insights");
  const [category, setCategory] = useState<Category>("all");
  const [running,  setRunning]  = useState(false);
  const [toast,    setToast]    = useState<{ msg: string; type?: "ok" | "warn" } | null>(null);
  const [search,   setSearch]   = useState("");

  const showToast = (msg: string, type: "ok" | "warn" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/transcripts/status");
      if (r.ok) setStatus(await r.json() as Status);
    } catch { /* ignore */ }
  }, []);

  const fetchInsights = useCallback(async () => {
    const cat = category === "all" ? "" : category;
    const r   = await fetch(`/api/transcripts/insights?category=${cat}&limit=200`);
    if (r.ok) {
      const d = await r.json() as { insights: Insight[]; total: number };
      setInsights(d.insights);
      setTotal(d.total);
    }
  }, [category]);

  const fetchHistory = useCallback(async (page = 1) => {
    const r = await fetch(`/api/transcripts/history?limit=50&page=${page}`);
    if (r.ok) {
      const d = await r.json() as { videos: VideoHistory[]; total: number; page: number };
      setHistory(prev => page === 1 ? d.videos : [...prev, ...d.videos]);
      setHistoryTotal(d.total);
      setHistoryPage(d.page);
    }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);
  useEffect(() => { void fetchInsights(); }, [fetchInsights]);
  useEffect(() => { if (view === "history") void fetchHistory(1); }, [view, fetchHistory]);

  // Poll status while running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void fetchStatus(), 3000);
    return () => clearInterval(id);
  }, [running, fetchStatus]);

  const handleRun = async (limit: number) => {
    setRunning(true);
    try {
      const r = await fetch(`/api/transcripts/analyze?limit=${limit}`, { method: "POST" });
      const d = await r.json() as { queued?: number; processed?: number; message?: string; error?: string };
      if (!r.ok) {
        showToast(`Error: ${d.error ?? "Unknown error"}`, "warn");
        setRunning(false);
        return;
      }
      if (d.queued === 0 || d.processed === 0) {
        showToast(d.message ?? "All videos already analyzed — nothing new to process.", "warn");
        setRunning(false);
        return;
      }
      showToast(d.message ?? `Queued ${d.queued} videos`);
      const wait = Math.min((d.queued ?? 1) * 4000, 120_000);
      setTimeout(async () => {
        setRunning(false);
        await fetchStatus();
        await fetchInsights();
        if (view === "history") await fetchHistory(1);
      }, wait);
    } catch {
      showToast("Request failed — is the API server running?", "warn");
      setRunning(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Clear all extracted insights? This cannot be undone.")) return;
    await fetch("/api/transcripts/insights", { method: "DELETE" });
    await fetchStatus();
    setInsights([]);
    setTotal(0);
    setHistory([]);
    setHistoryTotal(0);
    showToast("All insights cleared.");
  };

  const filtered = search.trim()
    ? insights.filter(i =>
        i.text.toLowerCase().includes(search.toLowerCase()) ||
        i.tickers.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : insights;

  const counts = insights.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

  const hasMoreHistory = history.length < historyTotal;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Header */}
        <div>
          <h1 className="font-display text-2xl tracking-wider text-primary">TRANSCRIPT LAB</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Claude extracts trading rules, setups, and market calls from Oscar Carboni transcripts.
          </p>
        </div>

        {/* Status / run panel */}
        <StatusBar status={status} onRun={handleRun} onReset={handleReset} running={running} />

        {/* Toast */}
        {toast && (
          <div className={cn(
            "rounded px-4 py-2 text-sm font-mono border",
            toast.type === "warn"
              ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
              : "bg-primary/10 border-primary/30 text-primary"
          )}>
            {toast.msg}
          </div>
        )}

        {/* File path hint if missing */}
        {status && !status.fileExists && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-xs font-mono text-destructive space-y-1">
            <p className="font-semibold">Transcript file not found</p>
            <p>Set <code>TRANSCRIPT_FILE_PATH</code> before starting the API server:</p>
            <p className="text-foreground bg-background rounded px-2 py-1 mt-1">
              $env:TRANSCRIPT_FILE_PATH = "C:\Users\napan\OneDrive\Desktop\oscar_carboni_all_transcripts.txt"
            </p>
          </div>
        )}

        {/* View tabs */}
        <div className="flex items-center gap-1 border-b border-border pb-0">
          <button
            onClick={() => setView("insights")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-semibold border-b-2 -mb-px transition-colors",
              view === "insights"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <BookOpen className="w-3.5 h-3.5" />
            INSIGHTS
            {total > 0 && <span className="text-[10px] opacity-60">({total})</span>}
          </button>
          <button
            onClick={() => setView("history")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-semibold border-b-2 -mb-px transition-colors",
              view === "history"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Clock className="w-3.5 h-3.5" />
            HISTORY
            {historyTotal > 0 && <span className="text-[10px] opacity-60">({historyTotal} videos)</span>}
          </button>
        </div>

        {/* ── INSIGHTS VIEW ─────────────────────────────────────────────────── */}
        {view === "insights" && (
          <>
            {insights.length > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-1 flex-wrap">
                  {CATEGORIES.map(c => (
                    <button
                      key={c.key}
                      onClick={() => setCategory(c.key)}
                      className={cn(
                        "px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors",
                        category === c.key
                          ? "bg-primary/10 text-primary border border-primary/30"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      {c.label}
                      {c.key !== "all" && counts[c.key]
                        ? <span className="ml-1 opacity-60">({counts[c.key]})</span>
                        : null}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Search insights or tickers…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-52 bg-card border border-border rounded px-3 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            {filtered.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">
                  {filtered.length.toLocaleString()} insight{filtered.length !== 1 ? "s" : ""}
                  {search ? ` matching "${search}"` : ""}
                </p>
                {filtered.map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            ) : status?.processed === 0 ? (
              <div className="text-center text-muted-foreground py-20">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No insights yet.</p>
                <p className="text-xs mt-1">Click <span className="text-primary">Run Analysis</span> to start extracting trading knowledge from Oscar's transcripts.</p>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-16 text-sm">
                No insights match your filter.
              </div>
            )}
          </>
        )}

        {/* ── HISTORY VIEW ──────────────────────────────────────────────────── */}
        {view === "history" && (
          <>
            {history.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-mono">
                  {historyTotal.toLocaleString()} processed video{historyTotal !== 1 ? "s" : ""} — most recent first
                </p>
                {history.map((v, i) => <VideoHistoryCard key={i} video={v} />)}
                {hasMoreHistory && (
                  <button
                    onClick={() => fetchHistory(historyPage + 1)}
                    className="w-full py-2 text-xs font-mono text-muted-foreground hover:text-foreground border border-border rounded hover:bg-muted/20 transition-colors"
                  >
                    Load more ({historyTotal - history.length} remaining)
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-20">
                <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No videos processed yet.</p>
                <p className="text-xs mt-1">Run the analysis above to populate history.</p>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
