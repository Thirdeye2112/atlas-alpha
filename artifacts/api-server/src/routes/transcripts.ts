import { Router } from "express";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { db, transcriptInsightsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { TranscriptInsight } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const transcriptsRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFilePath(): string {
  return process.env.TRANSCRIPT_FILE_PATH
    ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", "OneDrive", "Desktop", "oscar_carboni_all_transcripts.txt");
}

interface ParsedVideo {
  title: string;
  url: string;
  videoId: string;
  text: string;
}

// Strip YouTube auto-caption (VTT) noise so transcripts are readable and the
// distiller gets cleaner input: inline <timestamp> / <c> tags + "Kind:" header.
function cleanCaptions(text: string): string {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
    .replace(/<\/?c[^>]*>/g, "")
    .replace(/Kind:\s*captions\s+Language:\s*\S+/i, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// YouTube auto-captions repeat each phrase 2-3 times as the rolling caption
// scrolls ("good morning good afternoon good morning good afternoon ..."). Collapse
// any window of up to MAXW words that immediately repeats the preceding window.
// Heavier than cleanCaptions, so only used when serving/analyzing a single video.
function dedupeCaptions(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const MAXW = 12;
  const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  for (const w of words) {
    out.push(w);
    const maxL = Math.min(MAXW, out.length >> 1);
    for (let L = maxL; L >= 1; L--) {
      let match = true;
      for (let k = 0; k < L; k++) {
        if (!eqCI(out[out.length - L + k], out[out.length - 2 * L + k])) { match = false; break; }
      }
      if (match) { out.length -= L; break; }   // drop the repeated window
    }
  }
  return out.join(" ");
}

// Parse a transcript dump into videos. Robust to BOTH formats we've seen:
//   * newer scraper: "VIDEO TITLE:" + "VIDEO URL:" + ---- + body + ==== divider
//   * older dump:    "VIDEO TITLE:" + ---- + body   (no URL, no ==== dividers)
// Splitting on the "VIDEO TITLE:" marker handles both. maxLen caps each body
// (pass Infinity for the full transcript reader view).
function parseTranscriptFile(filePath: string, maxLen = 6000): ParsedVideo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const videos: ParsedVideo[] = [];

  const parts = content.split(/^VIDEO TITLE:[ \t]*/m);
  for (let i = 1; i < parts.length; i++) {   // parts[0] is the file header
    const block = parts[i];
    const nl = block.indexOf("\n");
    const title = (nl >= 0 ? block.slice(0, nl) : block).trim();
    // stop this video at the next ==== divider (newer format) if present
    const rest = (nl >= 0 ? block.slice(nl + 1) : "").split(/^={10,}[ \t]*$/m)[0];

    const urlMatch = rest.match(/^VIDEO URL:\s*(\S+)/m);
    const url = urlMatch?.[1]?.trim() ?? "";
    const idMatch = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);

    // body = after the first dashed separator if present, else the rest minus the URL line
    let body = rest;
    const dash = body.search(/^-{5,}[ \t]*$/m);
    if (dash >= 0) {
      const after = body.indexOf("\n", dash);
      body = after >= 0 ? body.slice(after + 1) : "";
    } else if (urlMatch) {
      body = body.replace(/^VIDEO URL:.*$/m, "");
    }
    body = cleanCaptions(body);
    if (body.length < 50) continue;            // skip [No transcript] stubs

    videos.push({
      title,
      url:     url || title,                   // url doubles as the dedup key (DB unique)
      videoId: idMatch?.[1] ?? (url || title),
      text:    body.slice(0, maxLen),
    });
  }

  return videos;
}

function buildAnthropicClient() {
  const replitKey  = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const replitBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const directKey  = process.env.ANTHROPIC_API_KEY;
  if (!replitKey && !directKey) return null;
  const opts: ConstructorParameters<typeof Anthropic>[0] = replitBase
    ? { apiKey: replitKey, baseURL: replitBase }
    : { apiKey: directKey };
  return new Anthropic(opts);
}

async function extractInsights(client: Anthropic, video: ParsedVideo): Promise<{ insights: TranscriptInsight[]; summary: string; tokens: number }> {
  const prompt = `You are extracting structured trading knowledge from a transcript by Oscar Carboni, a professional trader.

VIDEO: "${video.title}"
TRANSCRIPT:
${dedupeCaptions(video.text)}

Extract all concrete, actionable trading insights. Return a JSON object with exactly these fields:
{
  "summary": "2-3 sentence summary of the key market view in this video",
  "insights": [
    {
      "category": "indicator" | "rule" | "setup" | "market_call" | "risk",
      "text": "concise statement of the insight (max 120 chars)",
      "confidence": "high" | "medium" | "low",
      "tickers": ["SPY", "QQQ"]  // empty array if no specific tickers
    }
  ]
}

Categories:
- indicator: how Oscar uses OMNI, OSCAR oscillator, or other technical indicators
- rule: a trading rule or condition ("when X happens, do Y")
- setup: a specific trade setup or pattern to watch
- market_call: a directional market prediction or current market assessment
- risk: risk management or position sizing guidance

Only include insights with clear, specific content. Skip vague generalities. Return valid JSON only.`;

  const msg = await client.messages.create({
    model:      "claude-haiku-4-5",
    max_tokens: 1024,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { insights: [], summary: "", tokens: msg.usage.input_tokens + msg.usage.output_tokens };

  const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; insights?: TranscriptInsight[] };
  return {
    summary:  parsed.summary ?? "",
    insights: (parsed.insights ?? []).slice(0, 15),
    tokens:   msg.usage.input_tokens + msg.usage.output_tokens,
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/transcripts/status
transcriptsRouter.get("/transcripts/status", async (req, res) => {
  try {
    const filePath  = getFilePath();
    const fileExists = fs.existsSync(filePath);

    let processed = 0;
    let totalInsights = 0;
    try {
      const [r1] = await db.select({ processed: sql<number>`count(*)::int` }).from(transcriptInsightsTable);
      const [r2] = await db.select({ totalInsights: sql<number>`coalesce(sum(jsonb_array_length(insights)),0)::int` }).from(transcriptInsightsTable);
      processed    = r1?.processed    ?? 0;
      totalInsights = r2?.totalInsights ?? 0;
    } catch {
      // Table may not exist yet — return zeros so the UI still renders
    }

    let totalVideos = 0;
    if (fileExists) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        totalVideos = (content.match(/^VIDEO TITLE:/gm) ?? []).length;
      } catch { /* ignore */ }
    }

    res.json({ filePath, fileExists, totalVideos, processed, totalInsights });
  } catch (err) {
    req.log.error({ err }, "transcripts status error");
    res.status(500).json({ error: "Failed to get status" });
  }
});

// POST /api/transcripts/analyze  — process next N unprocessed videos
transcriptsRouter.post("/transcripts/analyze", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 50);

  const client = buildAnthropicClient();
  if (!client) {
    res.status(400).json({ error: "No Anthropic API key configured. Set ANTHROPIC_API_KEY in your local .env file." });
    return;
  }

  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: `Transcript file not found: ${filePath}. Set TRANSCRIPT_FILE_PATH env var to the correct path.` });
    return;
  }

  // Get already-processed URLs
  const done = new Set(
    (await db.select({ url: transcriptInsightsTable.videoUrl }).from(transcriptInsightsTable))
      .map(r => r.url)
  );

  const all     = parseTranscriptFile(filePath);
  const pending = all.filter(v => !done.has(v.url)).slice(0, limit);

  if (pending.length === 0) {
    res.json({ processed: 0, message: "All videos already analyzed — nothing new to process." });
    return;
  }

  // Respond immediately, process async
  res.json({ queued: pending.length, message: `Processing ${pending.length} videos in background. Refresh status to track progress.` });

  // Background processing (fire and forget from the request perspective)
  void (async () => {
    let done_count = 0;
    let err_count  = 0;
    for (const video of pending) {
      try {
        const { insights, summary, tokens } = await extractInsights(client, video);
        await db.insert(transcriptInsightsTable).values({
          videoTitle:  video.title,
          videoUrl:    video.url,
          insights,
          rawSummary:  summary,
          tokenCount:  tokens,
        }).onConflictDoUpdate({
          target:  transcriptInsightsTable.videoUrl,
          set:     { insights, rawSummary: summary, tokenCount: tokens, processedAt: new Date() },
        });
        done_count++;
        logger.info({ title: video.title, insights: insights.length }, "transcript.processed");
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        err_count++;
        logger.error({ err, title: video.title }, "transcript.error");
      }
    }
    logger.info({ done_count, err_count }, "transcript.batch_complete");
  })();
});

// GET /api/transcripts/insights
transcriptsRouter.get("/transcripts/insights", async (req, res) => {
  try {
    const category = req.query.category as string | undefined;
    const page     = Math.max(1, Number(req.query.page ?? 1));
    const limit    = Math.min(Number(req.query.limit ?? 50), 200);
    const offset   = (page - 1) * limit;

    // Fetch all rows, filter in JS (jsonb array filter in drizzle is verbose)
    const rows = await db
      .select()
      .from(transcriptInsightsTable)
      .orderBy(sql`processed_at DESC`)
      .limit(500);

    const result = rows.flatMap(row =>
      (row.insights as TranscriptInsight[])
        .filter(ins => !category || ins.category === category)
        .map(ins => ({
          ...ins,
          videoTitle: row.videoTitle,
          videoUrl:   row.videoUrl,
          processedAt: row.processedAt,
        }))
    ).slice(offset, offset + limit);

    const total = rows.reduce((acc, r) => {
      const filtered = (r.insights as TranscriptInsight[]).filter(i => !category || i.category === category);
      return acc + filtered.length;
    }, 0);

    res.json({ insights: result, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "transcripts insights error");
    res.status(500).json({ error: "Failed to fetch insights" });
  }
});

// DELETE /api/transcripts/insights  — reset all
transcriptsRouter.delete("/transcripts/insights", async (req, res) => {
  try {
    await db.delete(transcriptInsightsTable);
    res.json({ message: "All transcript insights cleared." });
  } catch (err) {
    req.log.error({ err }, "transcripts delete error");
    res.status(500).json({ error: "Failed to clear insights" });
  }
});

// GET /api/transcripts/videos  — per-video history (so you can browse the raw
// transcripts and spot details the distiller skipped). Joins the file's videos
// with their distilled insights/summary by URL. Optional ?search= title filter.
transcriptsRouter.get("/transcripts/videos", async (req, res) => {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      res.json({ available: false, reason: `Transcript file not found: ${filePath}`, videos: [] });
      return;
    }
    const search = (typeof req.query.search === "string" ? req.query.search : "").toLowerCase();

    const videos = parseTranscriptFile(filePath, Infinity);

    let byUrl = new Map<string, { rawSummary: string | null; insights: TranscriptInsight[]; processedAt: Date | null }>();
    try {
      const rows = await db.select().from(transcriptInsightsTable);
      byUrl = new Map(rows.map(r => [r.videoUrl, {
        rawSummary: r.rawSummary,
        insights: (r.insights as TranscriptInsight[]) ?? [],
        processedAt: r.processedAt ?? null,
      }]));
    } catch { /* table may not exist yet — everything shows as unprocessed */ }

    let list = videos.map(v => {
      const row = byUrl.get(v.url);
      return {
        videoId:      v.videoId,
        title:        v.title,
        url:          v.url,
        textLength:   v.text.length,
        processed:    !!row,
        insightCount: row?.insights.length ?? 0,
        summary:      row?.rawSummary ?? "",
        processedAt:  row?.processedAt ?? null,
      };
    });
    if (search) list = list.filter(v => v.title.toLowerCase().includes(search));

    res.json({
      available: true,
      count: list.length,
      processedCount: list.filter(v => v.processed).length,
      videos: list,
    });
  } catch (err) {
    req.log.error({ err }, "transcripts videos error");
    res.status(500).json({ error: "Failed to list videos" });
  }
});

// GET /api/transcripts/video/:videoId  — one video's FULL raw transcript text +
// its distilled summary/insights. The reader view for "is there more to pull out?".
transcriptsRouter.get("/transcripts/video/:videoId", async (req, res) => {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Transcript file not found" });
      return;
    }
    const key = decodeURIComponent(req.params.videoId);
    const videos = parseTranscriptFile(filePath, Infinity);
    const v = videos.find(x => x.videoId === key || x.url === key);
    if (!v) {
      res.status(404).json({ error: `Video not found: ${key}` });
      return;
    }

    let row: { rawSummary: string | null; insights: TranscriptInsight[]; processedAt: Date | null } | undefined;
    try {
      const [r] = await db.select().from(transcriptInsightsTable).where(eq(transcriptInsightsTable.videoUrl, v.url));
      if (r) row = { rawSummary: r.rawSummary, insights: (r.insights as TranscriptInsight[]) ?? [], processedAt: r.processedAt ?? null };
    } catch { /* table may not exist yet */ }

    res.json({
      videoId:     v.videoId,
      title:       v.title,
      url:         v.url,
      text:        dedupeCaptions(v.text),
      processed:   !!row,
      summary:     row?.rawSummary ?? "",
      insights:    row?.insights ?? [],
      processedAt: row?.processedAt ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "transcripts video error");
    res.status(500).json({ error: "Failed to fetch video" });
  }
});
