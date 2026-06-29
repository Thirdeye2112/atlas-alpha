import { useState, useEffect, useCallback } from "react";
import { FileText, Play, RotateCcw, Trash2, ExternalLink, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Category = "all" | "indicator" | "rule" | "setup" | "market_call" | "risk";

interface Insight {
  category: Exclude<Category, "all">;
  text: string;
  confidence: "high" | "medium" | "low";
  tickers: string[];
  videoTitle: string;
  videoUrl: string;
  processedAt: string;
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
            disabled={running || !status?.fileExists}
            title={!status?.fileExists ? "Transcript file not found — check the path shown above" : undefined}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors",
              (running || !status?.fileExists)
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

// ── Transcript history (raw transcript reader) ──────────────────────────────────

interface VideoSummary {
  videoId: string;
  title: string;
  url: string;
  textLength: number;
  processed: boolean;
  insightCount: number;
  summary: string;
  processedAt: string | null;
}

interface VideoDetail extends VideoSummary {
  text: string;
  insights: Omit<Insight, "videoTitle" | "videoUrl" | "processedAt">[];
}

function VideoHistoryCard({ video }: { video: VideoSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail) {
      setLoading(true);
      try {
        const r = await fetch(`/api/transcripts/video/${encodeURIComponent(video.videoId)}`);
        if (r.ok) setDetail(await r.json() as VideoDetail);
      } catch { /* ignore */ }
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button onClick={() => void toggle()} className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-snug truncate">{video.title}</p>
          <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-muted-foreground">
            <span className={cn("px-1.5 py-0.5 rounded border", video.processed ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" : "text-muted-foreground border-border")}>
              {video.processed ? `${video.insightCount} insight${video.insightCount !== 1 ? "s" : ""}` : "not analyzed"}
            </span>
            <span>{(video.textLength / 1000).toFixed(1)}k chars</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border/50 p-3 space-y-3">
          {loading && <p className="text-xs text-muted-foreground font-mono">Loading transcript…</p>}
          {detail && (
            <>
              {detail.summary && (
                <div>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Summary</p>
                  <p className="text-xs text-foreground leading-relaxed">{detail.summary}</p>
                </div>
              )}
              {detail.insights.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Distilled insights</p>
                  <ul className="space-y-1">
                    {detail.insights.map((ins, i) => (
                      <li key={i} className="text-xs text-foreground flex gap-2">
                        <span className={cn("shrink-0 text-[9px] font-mono px-1 rounded border uppercase self-start", CAT_COLORS[ins.category])}>{ins.category.replace("_", " ")}</span>
                        <span>{ins.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] font-mono uppercase text-muted-foreground">Raw transcript</p>
                  <a href={detail.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] text-primary hover:underline">Watch <ExternalLink className="w-2.5 h-2.5" /></a>
                </div>
                <pre className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto bg-background rounded p-2 border border-border/50">{detail.text}</pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TranscriptHistory() {
  const [videos,  setVideos]  = useState<VideoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");
  const [meta,    setMeta]    = useState<{ count: number; processedCount: number } | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/transcripts/videos");
        if (r.ok) {
          const d = await r.json() as { videos: VideoSummary[]; count: number; processedCount: number };
          setVideos(d.videos ?? []);
          setMeta({ count: d.count, processedCount: d.processedCount });
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  const filtered = search.trim()
    ? videos.filter(v => v.title.toLowerCase().includes(search.toLowerCase()))
    : videos;

  if (loading) return <p className="text-xs text-muted-foreground font-mono py-10 text-center">Loading transcript history…</p>;
  if (videos.length === 0) return (
    <div className="text-center text-muted-foreground py-16 text-sm">
      No transcripts found. Check the transcript file path above, or run the scraper.
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground font-mono">
          {meta?.count.toLocaleString()} videos · <span className="text-emerald-400">{meta?.processedCount.toLocaleString()} analyzed</span>
          {search ? ` · ${filtered.length} matching` : ""}
        </p>
        <input
          type="text"
          placeholder="Search transcripts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-52 bg-card border border-border rounded px-3 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {filtered.map(v => <VideoHistoryCard key={v.videoId} video={v} />)}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TranscriptLab() {
  const [status,   setStatus]   = useState<Status | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [total,    setTotal]    = useState(0);
  const [category, setCategory] = useState<Category>("all");
  const [running,  setRunning]  = useState(false);
  const [toast,    setToast]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [view,     setView]     = useState<"insights" | "history">("insights");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
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

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);
  useEffect(() => { void fetchInsights(); }, [fetchInsights]);

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
      const d = await r.json() as { queued?: number; message?: string; error?: string };
      if (!r.ok) {
        showToast(`Error: ${d.error ?? "Unknown error"}`);
        setRunning(false);
        return;
      }
      showToast(d.message ?? `Queued ${d.queued} videos`);
      // Stop "running" spinner after ~15s per video estimate, then refresh
      const wait = Math.min((d.queued ?? 1) * 4000, 120_000);
      setTimeout(async () => {
        setRunning(false);
        await fetchStatus();
        await fetchInsights();
      }, wait);
    } catch {
      showToast("Request failed — is the API server running?");
      setRunning(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Clear all extracted insights? This cannot be undone.")) return;
    await fetch("/api/transcripts/insights", { method: "DELETE" });
    await fetchStatus();
    setInsights([]);
    setTotal(0);
    showToast("All insights cleared.");
  };

  const filtered = search.trim()
    ? insights.filter(i =>
        i.text.toLowerCase().includes(search.toLowerCase()) ||
        i.tickers.some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : insights;

  // Count by category for tab badges
  const counts = insights.reduce<Record<string, number>>((acc, i) => {
    acc[i.category] = (acc[i.category] ?? 0) + 1;
    return acc;
  }, {});

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
          <div className="bg-primary/10 border border-primary/30 rounded px-4 py-2 text-sm font-mono text-primary">
            {toast}
          </div>
        )}

        {/* File path hint if missing */}
        {status && !status.fileExists && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3 text-xs font-mono text-destructive space-y-1">
            <p className="font-semibold">Transcript file not found</p>
            <p>Set <code>TRANSCRIPT_FILE_PATH</code> in your local <code>.env</code> or <code>start.ps1</code>:</p>
            <p className="text-foreground bg-background rounded px-2 py-1 mt-1">
              TRANSCRIPT_FILE_PATH=C:\Users\napan\OneDrive\Desktop\oscar_carboni_all_transcripts.txt
            </p>
          </div>
        )}

        {/* View toggle: distilled insights vs raw transcript history */}
        <div className="flex gap-1">
          {([["insights", "Insights"], ["history", "Transcript History"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={cn(
                "px-3 py-1 rounded text-xs font-mono font-semibold transition-colors",
                view === k
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "history" && <TranscriptHistory />}

        {view === "insights" && (<>
        {/* Category tabs + search */}
        {insights.length > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1">
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

        {/* Insights grid */}
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
        </>)}

      </div>
    </div>
  );
}
