/**
 * Dynamic universe loader — fetches all US-listed stocks from the Nasdaq
 * screener API (free, no key required) and merges them into the scanner
 * universe at startup.  The scanner's liquidityFilter (≥1M 3-month avg volume)
 * is the real quality gate; this loader uses a lighter pre-filter (≥300K
 * last-day volume) to avoid fetching Yahoo Finance data for obvious penny stocks.
 *
 * Falls back silently to the static SCANNER_UNIVERSE on any network error.
 */

import { extendUniverse } from "./scannerUniverse.js";
import { logger } from "./logger.js";

const SCREENER_URL =
  "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true";

/** Last-day volume pre-filter — well below the 1M 3-month avg gate in the scanner. */
const PRE_FILTER_VOLUME = 300_000;

/** Only accept clean alphabetic symbols (1-5 chars). Excludes warrants, units, preferred (.W .U .RT). */
const CLEAN_SYMBOL = /^[A-Z]{1,5}$/;

interface NasdaqRow {
  symbol:    string;
  name:      string;
  volume:    string;   // "1,234,567" or ""
  country:   string;
  lastsale:  string;
}

interface NasdaqResponse {
  data: {
    rows: NasdaqRow[];
  };
}

function parseVolume(raw: string): number {
  if (!raw) return 0;
  return parseInt(raw.replace(/,/g, ""), 10) || 0;
}

export async function loadDynamicUniverse(): Promise<void> {
  logger.info("Dynamic universe: fetching from Nasdaq screener…");

  let rows: NasdaqRow[];
  try {
    const resp = await fetch(SCREENER_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const json = (await resp.json()) as NasdaqResponse;
    rows = json?.data?.rows ?? [];
  } catch (err) {
    logger.warn({ err }, "Dynamic universe fetch failed — using static universe only");
    return;
  }

  const newTickers: string[] = [];
  for (const row of rows) {
    const sym = (row.symbol ?? "").trim().toUpperCase();

    // Skip malformed or non-US symbols
    if (!CLEAN_SYMBOL.test(sym)) continue;
    if (row.country && row.country !== "United States" && row.country !== "") continue;

    // Pre-filter by last-day volume
    if (parseVolume(row.volume) < PRE_FILTER_VOLUME) continue;

    // Skip very low-priced stocks (< $1 — almost always below liquidity gate anyway)
    const price = parseFloat((row.lastsale ?? "").replace("$", "")) || 0;
    if (price < 1) continue;

    newTickers.push(sym);
  }

  const added = extendUniverse(newTickers);
  logger.info(
    { screenerRows: rows.length, qualified: newTickers.length, newlyAdded: added },
    "Dynamic universe loaded",
  );
}
