import { useState } from "react";
import { Copy, Check, Terminal, GitBranch, FlaskConical, Radio, FileText, CalendarClock, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

interface Command {
  label: string;
  cmd: string;
  note?: string;
}

interface Section {
  title: string;
  icon: React.ElementType;
  color: string;
  commands: Command[];
}

const SECTIONS: Section[] = [
  {
    title: "Atlas Alpha App",
    icon: Terminal,
    color: "text-primary",
    commands: [
      { label: "Start API server",     cmd: "pnpm --filter @workspace/api-server run dev",    note: "Port 8080 → proxied at /api" },
      { label: "Start frontend",       cmd: "pnpm --filter @workspace/atlas-alpha run dev",   note: "Port 20959 → proxied at /" },
      { label: "Full typecheck",       cmd: "pnpm run typecheck" },
      { label: "Full build",           cmd: "pnpm run build" },
      { label: "Push DB schema",       cmd: "pnpm --filter @workspace/db run push",           note: "Dev only — applies Drizzle migrations" },
      { label: "Regen API hooks",      cmd: "pnpm --filter @workspace/api-spec run codegen",  note: "Run after editing openapi.yaml" },
    ],
  },
  {
    title: "GitHub Sync",
    icon: GitBranch,
    color: "text-blue-400",
    commands: [
      { label: "Pull latest (atlas-alpha)",    cmd: "cd C:\\Atlas\\atlas-alpha && git pull origin main" },
      { label: "Pull latest (atlas-research)", cmd: "cd C:\\Atlas\\atlas-research && git pull origin main" },
      { label: "Push changes (atlas-alpha)",   cmd: "cd C:\\Atlas\\atlas-alpha && git add -A && git commit -m \"msg\" && git push origin main" },
      { label: "Push changes (atlas-research)",cmd: "cd C:\\Atlas\\atlas-research && git add -A && git commit -m \"msg\" && git push origin main" },
    ],
  },
  {
    title: "Transcript Scrapers",
    icon: FileText,
    color: "text-emerald-400",
    commands: [
      {
        label: "Oscar Carboni — incremental update",
        cmd:   "python scripts\\scrape_transcripts.py --output \"%USERPROFILE%\\OneDrive\\Desktop\\oscar_carboni_all_transcripts.txt\"",
        note:  "Skips known video IDs, appends new only",
      },
      {
        label: "Oscar Carboni — full re-scrape",
        cmd:   "python scripts\\scrape_transcripts.py --output \"%USERPROFILE%\\OneDrive\\Desktop\\oscar_carboni_all_transcripts.txt\" --full",
        note:  "Overwrites existing file",
      },
      {
        label: "ChartWhisperer — incremental update",
        cmd:   "python scripts\\scrape_chartwhisperer.py --output \"%USERPROFILE%\\OneDrive\\Desktop\\chartwhisperer_transcripts.txt\"",
        note:  "Requires Chrome cookies (yt-dlp). Skips known IDs.",
      },
      {
        label: "ChartWhisperer — dry run",
        cmd:   "python scripts\\scrape_chartwhisperer.py --dry-run",
        note:  "Shows what would be scraped, no downloads",
      },
    ],
  },
  {
    title: "Tick Data & Stream",
    icon: Radio,
    color: "text-orange-400",
    commands: [
      {
        label: "Alpaca tick backfill",
        cmd:   "python scripts\\alpaca_tick_collector.py --ticker AAPL --start 2025-01-01",
        note:  "Backfills historical tick data to Parquet. Add --tickers for multi.",
      },
      {
        label: "Live tick stream (manual)",
        cmd:   "python scripts\\alpaca_stream_auto.py",
        note:  "Market-hours aware; auto-connects WebSocket, saves to Parquet",
      },
      {
        label: "NBBO snapshot",
        cmd:   "python scripts\\alpaca_tick_collector.py --snapshot --ticker AAPL",
        note:  "Single NBBO quote snapshot",
      },
    ],
  },
  {
    title: "Research Scripts",
    icon: FlaskConical,
    color: "text-violet-400",
    commands: [
      {
        label: "Candle ME study",
        cmd:   "python scripts\\candle_me_study.py --ticker AAPL --data-dir C:\\Atlas\\data",
        note:  "64-feature mutual exclusivity study; outputs rise/drop predictors",
      },
      {
        label: "Ingest transcripts → DB",
        cmd:   "python scripts\\ingest_transcripts.py",
        note:  "Claude extracts hypotheses from transcript file; writes to atlas_research DB",
      },
      {
        label: "Watch Oscar's channel",
        cmd:   "python scripts\\watch_oscar.py",
        note:  "Polls for new YouTube videos, triggers pipeline",
      },
      {
        label: "Nightly transcript pipeline",
        cmd:   "python scripts\\run_transcript_pipeline.py",
        note:  "Extract → backtest → promote hypotheses to signals",
      },
    ],
  },
  {
    title: "Scheduled Tasks (one-time setup)",
    icon: CalendarClock,
    color: "text-yellow-400",
    commands: [
      {
        label: "Register tick stream scheduler",
        cmd:   "powershell -ExecutionPolicy Bypass -File scripts\\setup_auto_stream.ps1",
        note:  "Runs at 6:25 AM Pacific Mon–Fri. Needs Admin shell.",
      },
      {
        label: "Register transcript scheduler",
        cmd:   "powershell -ExecutionPolicy Bypass -File scripts\\setup_transcript_scheduler.ps1",
        note:  "Runs daily at 7 PM. Needs Admin shell.",
      },
      {
        label: "Test transcript task now",
        cmd:   "Start-ScheduledTask -TaskName \"AtlasTranscriptScraper\"",
        note:  "Run in PowerShell",
      },
      {
        label: "Test stream task now",
        cmd:   "Start-ScheduledTask -TaskName \"AlpacaAutoStream\"",
        note:  "Run in PowerShell",
      },
      {
        label: "View transcript log",
        cmd:   "Get-Content C:\\Atlas\\atlas-alpha\\logs\\transcript_scraper.log -Tail 30",
        note:  "PowerShell",
      },
    ],
  },
  {
    title: "Environment Variables (PowerShell)",
    icon: KeyRound,
    color: "text-rose-400",
    commands: [
      { label: "Set Alpaca API key",    cmd: "$env:ALPACA_API_KEY = \"your_key_here\"",    note: "Needed for tick collector & auto-stream" },
      { label: "Set Alpaca secret",     cmd: "$env:ALPACA_SECRET_KEY = \"your_secret\"",   note: "Needed for tick collector & auto-stream" },
      { label: "Set GitHub token",      cmd: "$env:GITHUB_TOKEN = \"your_pat\"",           note: "Needed to push to GitHub from Replit" },
      { label: "Set DATABASE_URL",      cmd: "$env:DATABASE_URL = \"postgresql://...\"",   note: "Atlas Alpha Postgres connection string" },
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className={cn(
        "shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors",
        copied ? "text-emerald-400" : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function CommandRow({ c }: { c: Command }) {
  return (
    <div className="group flex items-start gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">{c.label}</div>
        <code className="block text-sm font-mono text-foreground break-all leading-snug">{c.cmd}</code>
        {c.note && <div className="text-[11px] text-muted-foreground/70 mt-0.5 italic">{c.note}</div>}
      </div>
      <CopyButton text={c.cmd} />
    </div>
  );
}

export default function CommandRef() {
  const [filter, setFilter] = useState("");
  const q = filter.toLowerCase();

  const filtered = SECTIONS.map((s) => ({
    ...s,
    commands: s.commands.filter(
      (c) =>
        !q ||
        c.label.toLowerCase().includes(q) ||
        c.cmd.toLowerCase().includes(q) ||
        (c.note ?? "").toLowerCase().includes(q)
    ),
  })).filter((s) => s.commands.length > 0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl tracking-wider text-primary">COMMAND REFERENCE</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All prompts & commands to run Atlas tools. Click the copy icon on any row.
            </p>
          </div>
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56 bg-card border border-border rounded-md px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {filtered.map((section) => (
          <div key={section.title} className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/20">
              <section.icon className={cn("w-4 h-4", section.color)} />
              <span className={cn("font-mono text-sm font-semibold tracking-wide", section.color)}>
                {section.title.toUpperCase()}
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">{section.commands.length} commands</span>
            </div>
            {section.commands.map((c) => (
              <CommandRow key={c.cmd} c={c} />
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-16">No commands match "{filter}"</div>
        )}

      </div>
    </div>
  );
}
