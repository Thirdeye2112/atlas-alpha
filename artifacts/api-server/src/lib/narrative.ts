import NodeCache from "node-cache";
import OpenAI from "openai";
import { logger } from "./logger.js";

const narrativeCache = new NodeCache({ stdTTL: 300 }); // 5-min TTL

function getClient(): OpenAI | null {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) return null;
  return new OpenAI({ baseURL, apiKey });
}

export interface NarrativeInput {
  ticker:            string;
  score:             number;
  direction:         string;
  timeHorizon:       string;
  bullishProbability:number;
  rsi14:             number;
  macdSignal:        string;
  priceAboveSma20:   boolean;
  priceAboveSma50:   boolean;
  priceAboveSma200:  boolean;
  relativeVolume:    number;
  vwapDistancePct:   number;
  atr14Pct:          number;
  bbWidth:           number;
  rankIC?:           number;
}

export async function generateNarrative(input: NarrativeInput): Promise<string | null> {
  if (process.env.ENABLE_AI_NARRATIVE !== "true") return null;

  // Cache by ticker + direction only — score fluctuates on every quote refresh which
  // would bust the cache constantly and mint a fresh OpenAI call each time.
  const scoreBucket = Math.round(input.score / 5) * 5;   // round to nearest 5 for prompt variety
  const cacheKey = `narrative:${input.ticker}:${input.direction}:${scoreBucket}`;
  const cached = narrativeCache.get<string>(cacheKey);
  if (cached) return cached;

  const client = getClient();
  if (!client) {
    logger.warn("AI narrative: OpenAI client not configured (set ENABLE_AI_NARRATIVE=true and provision OpenAI integration)");
    return null;
  }

  const smaCtx = [
    input.priceAboveSma20  ? "above 20-SMA"  : "below 20-SMA",
    input.priceAboveSma50  ? "above 50-SMA"  : "below 50-SMA",
    input.priceAboveSma200 ? "above 200-SMA" : "below 200-SMA",
  ].join(", ");

  const lines = [
    `You are a quant analyst writing a concise institutional signal summary for ${input.ticker}.`,
    `Atlas Score: ${input.score}/100 · Signal: ${input.direction.toUpperCase()} · Horizon: ${input.timeHorizon} · P(+return): ${input.bullishProbability.toFixed(0)}%.`,
    `Technical: RSI-14 ${input.rsi14.toFixed(1)}, MACD ${input.macdSignal}, price ${smaCtx}.`,
    `Volume/Volatility: RVOL ${input.relativeVolume.toFixed(2)}×, VWAP dist ${input.vwapDistancePct.toFixed(1)}%, ATR ${input.atr14Pct.toFixed(2)}%, BB-width ${input.bbWidth.toFixed(1)}%.`,
    input.rankIC !== undefined ? `Walk-forward Rank IC: ${input.rankIC.toFixed(3)}.` : "",
    `Write exactly 2 sentences. Sentence 1: key signal interpretation. Sentence 2: primary risk or confirmation needed. Bloomberg terminal style — dense, no filler words.`,
  ].filter(Boolean).join(" ");

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: lines }],
      max_tokens: 130,
      temperature: 0.25,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? null;
    if (text) narrativeCache.set(cacheKey, text);
    return text;
  } catch (err) {
    logger.warn({ err, ticker: input.ticker }, "AI narrative generation failed");
    return null;
  }
}
