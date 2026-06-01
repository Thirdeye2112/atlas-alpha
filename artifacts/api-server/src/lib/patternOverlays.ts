import type { OHLCVBar } from "./marketData.js";

export interface PatternLinePoint {
  date: string;
  price: number;
}

export interface PatternLine {
  points: PatternLinePoint[];
  style: "solid" | "dashed" | "dotted";
  color: string;
  label?: string;
}

export interface PatternTarget {
  price: number;
  label: string;
  role: "breakout" | "target" | "stop";
}

export interface PatternOverlay {
  type: "bull-flag" | "bear-flag" | "ascending-triangle" | "descending-triangle" | "double-bottom" | "head-and-shoulders";
  label: string;
  description: string;
  confidence: "high" | "medium" | "low";
  lines: PatternLine[];
  targets: PatternTarget[];
}

function argmax(arr: number[]): number {
  return arr.reduce((best, v, i) => (v > arr[best] ? i : best), 0);
}

function argmin(arr: number[]): number {
  return arr.reduce((best, v, i) => (v < arr[best] ? i : best), 0);
}

function r2(v: number) { return Math.round(v * 100) / 100; }

/**
 * Detect bull / bear flag at a specific time scale.
 *
 * @param poleLookback  Number of bars the pole spans (before the flag)
 * @param flagBars      Number of bars in the consolidation flag
 */
function detectFlag(
  bars: OHLCVBar[],
  poleLookback: number,
  flagBars: number,
): PatternOverlay | null {
  const n       = bars.length;
  if (n < poleLookback + flagBars) return null;

  const closes  = bars.map(b => b.close);
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);

  const poleStartIdx = n - poleLookback - flagBars;
  const poleEndIdx   = n - flagBars - 1;
  const flagStartIdx = n - flagBars;
  const flagEndIdx   = n - 1;

  const poleCloses  = closes.slice(poleStartIdx, poleEndIdx + 1);
  const poleHighs   = highs.slice(poleStartIdx, poleEndIdx + 1);
  const poleLows    = lows.slice(poleStartIdx, poleEndIdx + 1);
  const flagHighs   = highs.slice(flagStartIdx, flagEndIdx + 1);
  const flagLows    = lows.slice(flagStartIdx, flagEndIdx + 1);

  const poleGain    = (poleCloses[poleCloses.length - 1] - poleCloses[0]) / poleCloses[0] * 100;
  const poleTop     = Math.max(...poleHighs);
  const poleBase    = Math.min(...poleLows);
  // Net close-to-close move used for target projection (more accurate than H-L range)
  const poleNetMove = Math.abs(poleCloses[poleCloses.length - 1] - poleCloses[0]);
  // Full H-L range used only for "tight" ratio check
  const poleHeight  = poleTop - poleBase;

  const flagHigh  = Math.max(...flagHighs);
  const flagLow   = Math.min(...flagLows);
  const flagRange = flagHigh - flagLow;
  const poleRange = poleHeight;

  const volFlagAvg = volumes.slice(flagStartIdx).reduce((a, b) => a + b, 0) / flagBars;
  const volPoleAvg = volumes.slice(poleStartIdx, poleEndIdx + 1).reduce((a, b) => a + b, 0)
                   / (poleEndIdx - poleStartIdx + 1);
  const volDecline = volFlagAvg < volPoleAvg * 0.85;
  const tight      = poleRange > 0 && flagRange < poleRange * 0.55;

  // ── Bull Flag ────────────────────────────────────────────────────────────
  if (poleGain > 7 && tight && volDecline) {
    const mid      = Math.floor(flagBars / 2);
    const topStart = Math.max(...flagHighs.slice(0, mid));
    const topEnd   = Math.max(...flagHighs.slice(mid));
    const botStart = Math.min(...flagLows.slice(0, mid));
    const botEnd   = Math.min(...flagLows.slice(mid));

    const polePeakLocalIdx  = argmax(poleHighs);
    const polePeakDate      = bars[poleStartIdx + polePeakLocalIdx].time;
    const poleBaseDate      = bars[poleStartIdx + argmin(poleLows)].time;
    const flagStartDate     = bars[flagStartIdx].time;
    const flagEndDate       = bars[flagEndIdx].time;

    const breakoutPrice = r2(topEnd);
    const targetPrice   = r2(breakoutPrice + poleNetMove);
    const stopPrice     = r2(botEnd);

    const flagSlope  = ((topEnd - topStart) / topStart) * 100;
    const isTight    = flagRange < poleRange * 0.35;

    const confidence: PatternOverlay["confidence"] =
      poleGain > 25 ? "high" : poleGain > 12 ? "medium" : "low";

    return {
      type: "bull-flag",
      label: "Bull Flag",
      description:
        `+${poleGain.toFixed(1)}% pole · flag ${flagSlope >= 0 ? "+" : ""}${flagSlope.toFixed(1)}%${isTight ? " (tight)" : ""} · B/O ${breakoutPrice.toFixed(2)} · Target ${targetPrice.toFixed(2)}`,
      confidence,
      lines: [
        // Pole context — base to peak
        {
          points: [
            { date: poleBaseDate, price: poleBase    },
            { date: polePeakDate, price: poleTop     },
          ],
          style: "dotted",
          color: "rgba(34,197,94,0.28)",
          label: "Pole",
        },
        // Upper channel (breakout trigger)
        {
          points: [
            { date: flagStartDate, price: topStart },
            { date: flagEndDate,   price: topEnd   },
          ],
          style: "solid",
          color: "#22c55e",
          label: "Upper Channel",
        },
        // Lower channel (stop reference)
        {
          points: [
            { date: flagStartDate, price: botStart },
            { date: flagEndDate,   price: botEnd   },
          ],
          style: "solid",
          color: "rgba(34,197,94,0.45)",
          label: "Lower Channel",
        },
      ],
      targets: [
        { price: breakoutPrice, label: `B/O ${breakoutPrice.toFixed(2)}`,  role: "breakout" },
        { price: targetPrice,   label: `T1  ${targetPrice.toFixed(2)}`,    role: "target"   },
        { price: stopPrice,     label: `SL  ${stopPrice.toFixed(2)}`,      role: "stop"     },
      ],
    };
  }

  // ── Bear Flag ────────────────────────────────────────────────────────────
  if (poleGain < -7 && tight && volDecline) {
    const mid      = Math.floor(flagBars / 2);
    const topStart = Math.max(...flagHighs.slice(0, mid));
    const topEnd   = Math.max(...flagHighs.slice(mid));
    const botStart = Math.min(...flagLows.slice(0, mid));
    const botEnd   = Math.min(...flagLows.slice(mid));

    const poleTroughLocalIdx = argmin(poleLows);
    const poleTroughDate     = bars[poleStartIdx + poleTroughLocalIdx].time;
    const polePeakDate       = bars[poleStartIdx + argmax(poleHighs)].time;
    const flagStartDate      = bars[flagStartIdx].time;
    const flagEndDate        = bars[flagEndIdx].time;

    const breakdownPrice = r2(botEnd);
    const targetPrice    = r2(breakdownPrice - poleNetMove);
    const stopPrice      = r2(topEnd);

    const confidence: PatternOverlay["confidence"] =
      poleGain < -25 ? "high" : poleGain < -12 ? "medium" : "low";

    return {
      type: "bear-flag",
      label: "Bear Flag",
      description:
        `${poleGain.toFixed(1)}% pole · B/D ${breakdownPrice.toFixed(2)} · Target ${targetPrice.toFixed(2)}`,
      confidence,
      lines: [
        {
          points: [
            { date: polePeakDate,    price: poleTop    },
            { date: poleTroughDate,  price: poleBase   },
          ],
          style: "dotted",
          color: "rgba(239,68,68,0.28)",
          label: "Pole",
        },
        {
          points: [
            { date: flagStartDate, price: botStart },
            { date: flagEndDate,   price: botEnd   },
          ],
          style: "solid",
          color: "#ef4444",
          label: "Lower Channel",
        },
        {
          points: [
            { date: flagStartDate, price: topStart },
            { date: flagEndDate,   price: topEnd   },
          ],
          style: "solid",
          color: "rgba(239,68,68,0.45)",
          label: "Upper Channel",
        },
      ],
      targets: [
        { price: breakdownPrice, label: `B/D ${breakdownPrice.toFixed(2)}`, role: "breakout" },
        { price: targetPrice,    label: `T1  ${targetPrice.toFixed(2)}`,    role: "target"   },
        { price: stopPrice,      label: `SL  ${stopPrice.toFixed(2)}`,      role: "stop"     },
      ],
    };
  }

  return null;
}

/**
 * Calculate pattern overlays — angled trendlines and key price levels for
 * the most significant active structural pattern.
 *
 * Tries three time scales (short → medium → longer term) and returns the
 * first match, so it catches both fresh intraday flags and multi-month patterns.
 */
export function calcPatternOverlays(bars: OHLCVBar[]): PatternOverlay[] {
  if (bars.length < 30) return [];

  const n       = bars.length;
  const highs   = bars.map(b => b.high);
  const lows    = bars.map(b => b.low);
  const closes  = bars.map(b => b.close);

  // ── Multi-scale flag detection (short → medium → long) ─────────────────
  // Each scale = { poleLookback: <bars in pole>, flagBars: <bars in flag> }
  const FLAG_SCALES = [
    { poleLookback: 25, flagBars: 8  },   // ~1.5 months total
    { poleLookback: 50, flagBars: 15 },   // ~3 months total
    { poleLookback: 80, flagBars: 25 },   // ~5 months total
  ];

  for (const scale of FLAG_SCALES) {
    const overlay = detectFlag(bars, scale.poleLookback, scale.flagBars);
    if (overlay) return [overlay];
  }

  // ── Ascending Triangle ────────────────────────────────────────────────
  if (n >= 25) {
    const win    = 20;
    const tH     = highs.slice(-win);
    const tL     = lows.slice(-win);
    const maxH   = Math.max(...tH), minH = Math.min(...tH);
    const maxL   = Math.max(...tL), minL = Math.min(...tL);

    const flatTop    = maxH > 0 && (maxH - minH) / maxH < 0.025;
    const risingLows = tL[tL.length - 1] > tL[0] + (maxL - minL) * 0.35;

    if (flatTop && risingLows) {
      const startIdx   = n - win;
      const endIdx     = n - 1;
      const startDate  = bars[startIdx].time;
      const endDate    = bars[endIdx].time;
      const resistance = r2(maxH);
      const curSupport = r2(tL[tL.length - 1]);
      const target     = r2(resistance + (resistance - tL[0]));

      return [{
        type: "ascending-triangle",
        label: "Ascending Triangle",
        description: `Flat top ${resistance.toFixed(2)} · Rising support · B/O target ${target.toFixed(2)}`,
        confidence: "medium",
        lines: [
          {
            points: [
              { date: startDate, price: resistance },
              { date: endDate,   price: resistance },
            ],
            style: "solid",
            color: "#ef4444",
            label: "Resistance",
          },
          {
            points: [
              { date: startDate, price: r2(tL[0]) },
              { date: endDate,   price: curSupport },
            ],
            style: "solid",
            color: "#22c55e",
            label: "Rising Support",
          },
        ],
        targets: [
          { price: resistance, label: `B/O ${resistance.toFixed(2)}`, role: "breakout" },
          { price: target,     label: `T1  ${target.toFixed(2)}`,     role: "target"   },
        ],
      }];
    }
  }

  // ── Descending Triangle ───────────────────────────────────────────────
  if (n >= 25) {
    const win   = 20;
    const tH    = highs.slice(-win);
    const tL    = lows.slice(-win);
    const maxH  = Math.max(...tH), minH = Math.min(...tH);
    const maxL  = Math.max(...tL), minL = Math.min(...tL);

    const flatBot      = maxL > 0 && (maxL - minL) / maxL < 0.025;
    const fallingHighs = tH[tH.length - 1] < tH[0] - (maxH - minH) * 0.35;

    if (flatBot && fallingHighs) {
      const startIdx  = n - win;
      const endIdx    = n - 1;
      const startDate = bars[startIdx].time;
      const endDate   = bars[endIdx].time;
      const support   = r2(minL);
      const curResist = r2(tH[tH.length - 1]);
      const target    = r2(support - (tH[0] - support));

      return [{
        type: "descending-triangle",
        label: "Descending Triangle",
        description: `Flat support ${support.toFixed(2)} · Falling highs · B/D target ${target.toFixed(2)}`,
        confidence: "medium",
        lines: [
          {
            points: [
              { date: startDate, price: support },
              { date: endDate,   price: support },
            ],
            style: "solid",
            color: "#22c55e",
            label: "Support",
          },
          {
            points: [
              { date: startDate, price: r2(tH[0]) },
              { date: endDate,   price: curResist  },
            ],
            style: "solid",
            color: "#ef4444",
            label: "Falling Resistance",
          },
        ],
        targets: [
          { price: support, label: `B/D ${support.toFixed(2)}`, role: "breakout" },
          { price: target,  label: `T1  ${target.toFixed(2)}`,  role: "target"   },
        ],
      }];
    }
  }

  return [];
}
