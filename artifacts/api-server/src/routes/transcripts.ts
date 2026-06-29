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

function parseTranscriptFile(filePath: string): ParsedVideo[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const videos: ParsedVideo[] = [];

  // Split on the "===...===" divider lines (80 = signs)
  const blocks = content.split(/={60,}/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const titleMatch  = trimmed.match(/VIDEO TITLE:\s*(.+)/);
    const urlMatch    = trimmed.match(/VIDEO URL:\s*(https?:\/\/\S+)/);
    const idMatch     = urlMatch?.[1]?.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);

    if (!titleMatch || !urlMatch) continue;

    // Body is everything after the "---" separator
    const bodyStart = trimmed.indexOf("\n-");
    const body = bodyStart >= 0 ? trimmed.slice(bodyStart).replace(/^-+/m, "").trim() : "";
    if (body.length < 50) continue;  // skip [No transcript] stubs

    videos.push({
      title:   titleMatch[1].trim(),
      url:     urlMatch[1].trim(),
      videoId: idMatch?.[1] ?? urlMatch[1].trim(),
      text:    body.slice(0, 6000),  // cap per video to keep tokens reasonable
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
${video.text}

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

    const [{ processed }] = await db
      .select({ processed: sql<number>`count(*)::int` })
      .from(transcriptInsightsTable);

    const [{ totalInsights }] = await db
      .select({ totalInsights: sql<number>`coalesce(sum(jsonb_array_length(insights)),0)::int` })
      .from(transcriptInsightsTable);

    let totalVideos = 0;
    if (fileExists) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        totalVideos = (content.match(/VIDEO URL:/g) ?? []).length;
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
