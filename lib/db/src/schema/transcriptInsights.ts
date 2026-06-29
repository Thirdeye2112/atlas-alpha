import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export type TranscriptInsight = {
  category: "indicator" | "rule" | "setup" | "market_call" | "risk";
  text: string;
  confidence: "high" | "medium" | "low";
  tickers: string[];
};

export const transcriptInsightsTable = pgTable("transcript_insights", {
  id:           serial("id").primaryKey(),
  videoTitle:   text("video_title").notNull(),
  videoUrl:     text("video_url").notNull().unique(),
  processedAt:  timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  insights:     jsonb("insights").$type<TranscriptInsight[]>().notNull().default([]),
  rawSummary:   text("raw_summary").notNull().default(""),
  tokenCount:   integer("token_count").notNull().default(0),
});

export type TranscriptInsightRow = typeof transcriptInsightsTable.$inferSelect;
