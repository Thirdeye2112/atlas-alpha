import { useCallback, useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  UTCTimestamp,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineStyle,
  createSeriesMarkers,
  Time,
} from "lightweight-charts";
import { OHLCVBar } from "@workspace/api-client-react";
import type { PatternOverlay } from "@workspace/api-client-react";

export type { PatternOverlay };

export type DrawingTool = "pointer" | "trendline" | "hline" | "ray" | "rectangle";

export interface DrawingObject {
  id: string;
  type: "trendline" | "hline" | "ray" | "rectangle";
  color: string;
  p1: { time: string; price: number };
  p2: { time: string; price: number } | null;
}

const TOOL_COLORS: Record<DrawingTool, string> = {
  pointer:   "#60a5fa",
  trendline: "#60a5fa",
  hline:     "#fbbf24",
  ray:       "#a78bfa",
  rectangle: "#34d399",
};

export interface ChartPriceLine {
  price: number;
  label: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
}

export interface ChartLineSeries {
  label: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
  lineWidth?: 1 | 2 | 3 | 4;
  data: { time: string; value: number }[];
}

export interface ChartSignalMarker {
  date: string;
  direction: "bull" | "bear";
  label: string;
  strength: "strong" | "moderate";
}

export interface ExtendedHoursPoint {
  price: number;
  changePercent: number;
  type: "pre" | "post";
}

export interface ScoreOverlayPoint {
  time: string;
  score: number;
}

interface Props {
  data: OHLCVBar[];
  height?: number;
  onCandleClick?: (date: string, close: number) => void;
  priceLines?: ChartPriceLine[];
  lineSeries?: ChartLineSeries[];
  signals?: ChartSignalMarker[];
  showSwingPoints?: boolean;
  swingLookback?: number;
  patternOverlays?: PatternOverlay[];
  extendedHours?: ExtendedHoursPoint;
  scoreOverlay?: ScoreOverlayPoint[];
  activeTool?: DrawingTool;
  drawings?: DrawingObject[];
  onDrawingsChange?: (drawings: DrawingObject[]) => void;
}

function toChartTime(time: string): UTCTimestamp | string {
  if (time.length > 10) {
    return Math.floor(new Date(time).getTime() / 1000) as UTCTimestamp;
  }
  return time;
}

function toDateString(time: UTCTimestamp | string): string {
  if (typeof time === "number") {
    return new Date(time * 1000).toISOString().split("T")[0];
  }
  return String(time);
}

function timeToString(t: Time | undefined | null): string | null {
  if (t == null) return null;
  if (typeof t === "number") return new Date((t as number) * 1000).toISOString().slice(0, 10);
  if (typeof t === "string") return t;
  const bd = t as { year: number; month: number; day: number };
  return `${bd.year}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
}

function nextTradingDay(dateStr: string, skip = 1): string {
  const d = new Date(dateStr + "T12:00:00Z");
  let added = 0;
  while (added < skip) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

const LS_MAP: Record<string, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

function calcSMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    return sum / period;
  });
}

function describeSignal(label: string): string {
  if (label.startsWith("GAP+")) return `— gapped up ${label.slice(4)} above prior close`;
  if (label.startsWith("GAP-")) return `— gapped down ${label.slice(4)} below prior close`;
  const MAP: Record<string, string> = {
    "IB":    "— inside bar · price range contained within prior bar",
    "OB":    "— outside bar · engulfs prior bar's range",
    "BB↑":   "— closed above upper Bollinger Band",
    "BB↓":   "— closed below lower Bollinger Band",
    "BB↪":   "— bounced back inside Bollinger Bands",
    "RSI↑":  "— RSI recovered from oversold (< 30)",
    "RSI↓":  "— RSI retreated from overbought (> 70)",
    "MACD↑": "— MACD bullish crossover",
    "MACD↓": "— MACD bearish crossover",
    "VOL":   "— volume spike ≥ 2× average",
  };
  return MAP[label] ?? "";
}

interface FormattedBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SwingPoint {
  time: UTCTimestamp | string;
  direction: "high" | "low";
  price: number;
}

function computeSwingPoints(data: FormattedBar[], lookback: number): SwingPoint[] {
  const points: SwingPoint[] = [];
  const n = data.length;
  for (let i = lookback; i < n - lookback; i++) {
    const bar = data[i];
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (data[j].high >= bar.high) isHigh = false;
      if (data[j].low  <= bar.low)  isLow  = false;
    }
    if (isHigh) points.push({ time: bar.time, direction: "high", price: bar.high });
    if (isLow)  points.push({ time: bar.time, direction: "low",  price: bar.low  });
  }
  return points;
}

export default function LightweightChart({
  data,
  height = 400,
  onCandleClick,
  priceLines = [],
  lineSeries = [],
  signals = [],
  showSwingPoints = false,
  swingLookback = 3,
  patternOverlays = [],
  extendedHours,
  scoreOverlay = [],
  activeTool = "pointer",
  drawings = [],
  onDrawingsChange,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tooltipRef        = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<IChartApi | null>(null);
  const seriesRef         = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const drawingCanvasRef  = useRef<HTMLCanvasElement>(null);
  const pendingRef        = useRef<DrawingObject | null>(null);
  const hoverRef          = useRef<{ time: string; price: number } | null>(null);
  const drawingsRef       = useRef<DrawingObject[]>(drawings);
  const activeToolRef     = useRef<DrawingTool>(activeTool);

  const paintCanvas = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    const chart  = chartRef.current;
    const series = seriesRef.current;
    if (!canvas || !chart || !series) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx  = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = canvas.width  / dpr;

    const pending = pendingRef.current;
    const hover   = hoverRef.current;
    const ghost   = (pending && hover)
      ? { ...pending, p2: hover } as DrawingObject
      : null;

    const all = ghost ? [...drawingsRef.current, ghost] : [...drawingsRef.current];

    for (const d of all) {
      const isGhost = d === ghost;
      ctx.globalAlpha = isGhost ? 0.55 : 0.88;
      ctx.strokeStyle = d.color;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([]);

      if (d.type === "hline") {
        const y = series.priceToCoordinate(d.p1.price);
        if (y == null) continue;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = isGhost ? 0.45 : 0.75;
        ctx.font = `9px "JetBrains Mono", "Fira Code", monospace`;
        ctx.fillStyle = d.color;
        ctx.textAlign = "right";
        ctx.fillText(d.p1.price.toFixed(2), W - 5, y - 4);

      } else if (d.type === "trendline" && d.p2) {
        const x1 = chart.timeScale().timeToCoordinate(d.p1.time as Time);
        const y1 = series.priceToCoordinate(d.p1.price);
        const x2 = chart.timeScale().timeToCoordinate(d.p2.time as Time);
        const y2 = series.priceToCoordinate(d.p2.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        ctx.setLineDash(isGhost ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = isGhost ? 0.45 : 0.7;
        ctx.fillStyle = d.color;
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();

      } else if (d.type === "ray" && d.p2) {
        const x1 = chart.timeScale().timeToCoordinate(d.p1.time as Time);
        const y1 = series.priceToCoordinate(d.p1.price);
        const x2 = chart.timeScale().timeToCoordinate(d.p2.time as Time);
        const y2 = series.priceToCoordinate(d.p2.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        const dx = x2 - x1;
        ctx.setLineDash(isGhost ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        if (Math.abs(dx) > 0.5) {
          const slope = (y2 - y1) / dx;
          ctx.lineTo(W, y1 + slope * (W - x1));
        } else {
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = isGhost ? 0.45 : 0.7;
        ctx.fillStyle = d.color;
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();

      } else if (d.type === "rectangle" && d.p2) {
        const x1 = chart.timeScale().timeToCoordinate(d.p1.time as Time);
        const y1 = series.priceToCoordinate(d.p1.price);
        const x2 = chart.timeScale().timeToCoordinate(d.p2.time as Time);
        const y2 = series.priceToCoordinate(d.p2.price);
        if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
        const rx = Math.min(x1, x2);
        const ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1);
        const rh = Math.abs(y2 - y1);
        ctx.fillStyle = d.color;
        ctx.globalAlpha = isGhost ? 0.05 : 0.10;
        ctx.fillRect(rx, ry, rw, rh);
        ctx.globalAlpha = isGhost ? 0.50 : 0.85;
        ctx.strokeRect(rx, ry, rw, rh);
      }
    }

    ctx.restore();
  }, []);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "hsl(215 16% 65%)",
      },
      grid: {
        vertLines: { color: "hsl(222 15% 18%)" },
        horzLines: { color: "hsl(222 15% 18%)" },
      },
      width: chartContainerRef.current.clientWidth,
      height,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 10,
      },
      rightPriceScale: {
        minimumWidth: 60,
        borderVisible: false,
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: "hsl(210 100% 56%)",
          labelBackgroundColor: "hsl(222 18% 11%)",
        },
        horzLine: {
          color: "hsl(210 100% 56%)",
          labelBackgroundColor: "hsl(222 18% 11%)",
        },
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "hsl(142 71% 45%)",
      downColor: "hsl(0 84% 60%)",
      borderVisible: false,
      wickUpColor: "hsl(142 71% 45%)",
      wickDownColor: "hsl(0 84% 60%)",
    });

    const formattedData = data
      .map(d => ({
        time: toChartTime(d.time) as UTCTimestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));

    candlestickSeries.setData(formattedData);

    const hasScore = scoreOverlay.length > 0;
    if (hasScore) {
      candlestickSeries.priceScale().applyOptions({
        scaleMargins: { top: 0, bottom: 0.38 },
      });
    }

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: hasScore ? 0.83 : 0.78, bottom: 0 },
    });
    volumeSeries.setData(
      formattedData.map(bar => ({
        time: bar.time,
        value: bar.volume,
        color: bar.close >= bar.open
          ? "rgba(34,197,94,0.35)"
          : "rgba(239,68,68,0.35)",
      }))
    );

    if (hasScore) {
      const scoreSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        priceScaleId: "score",
        title: "",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      scoreSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.63, bottom: 0.19 },
        borderVisible: false,
      });
      scoreSeries.setData(
        scoreOverlay.map(p => ({
          time: toChartTime(p.time) as UTCTimestamp,
          value: p.score,
          color: p.score >= 65
            ? "rgba(52,211,153,0.55)"
            : p.score >= 45
            ? "rgba(251,191,36,0.55)"
            : "rgba(239,68,68,0.55)",
        }))
      );
      scoreSeries.createPriceLine({
        price: 50,
        color: "rgba(255,255,255,0.10)",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
    }

    const closes = data.map(d => d.close);
    const maConfigs: { period: number; color: string; title: string }[] = [
      { period: 50,  color: "#f97316", title: "SMA50"  },
      { period: 87,  color: "#a78bfa", title: "SMA87"  },
      { period: 200, color: "#ef4444", title: "SMA200" },
    ];

    for (const { period, color, title } of maConfigs) {
      const smaValues = calcSMA(closes, period);
      const maData = formattedData
        .map((bar, i) => smaValues[i] !== null ? { time: bar.time, value: smaValues[i]! } : null)
        .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);
      if (maData.length === 0) continue;
      const maSeries = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title,
      });
      maSeries.setData(maData);
    }

    if (lineSeries.length > 0) {
      for (const ls of lineSeries) {
        const validData = ls.data.filter(d => d.value > 0 && isFinite(d.value));
        if (validData.length < 2) continue;
        const customSeries = chart.addSeries(LineSeries, {
          color: ls.color,
          lineWidth: ls.lineWidth ?? 1,
          lineStyle: LS_MAP[ls.lineStyle] ?? LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: ls.label,
        });
        customSeries.setData(validData);
      }
    }

    if (priceLines.length > 0 && formattedData.length >= 2) {
      const lastBar  = formattedData[formattedData.length - 1];
      const prevBar  = formattedData[formattedData.length - 2];
      for (const pl of priceLines) {
        if (!pl.price || !isFinite(pl.price) || pl.price <= 0) continue;
        const stubSeries = chart.addSeries(LineSeries, {
          color: pl.color,
          lineWidth: 1,
          lineStyle: LS_MAP[pl.lineStyle] ?? LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: pl.label,
        });
        stubSeries.setData([
          { time: prevBar.time, value: pl.price },
          { time: lastBar.time, value: pl.price },
        ]);
      }
    }

    if (extendedHours && formattedData.length > 0) {
      const lastBar = formattedData[formattedData.length - 1];
      const lastDateStr = toDateString(lastBar.time);
      if (typeof lastBar.time === "string") {
        const nextDay = nextTradingDay(lastDateStr);
        const isPost = extendedHours.type === "post";
        const baseColor = isPost ? "#f59e0b" : "#818cf8";
        const prevClose = lastBar.close;
        const ehPrice   = extendedHours.price;
        const isUp      = ehPrice >= prevClose;
        const bodyColor = isUp ? "hsl(142 71% 45%)" : "hsl(0 84% 60%)";

        const ehSeries = chart.addSeries(CandlestickSeries, {
          upColor:        bodyColor,
          downColor:      bodyColor,
          borderUpColor:  bodyColor,
          borderDownColor: bodyColor,
          wickUpColor:    baseColor,
          wickDownColor:  baseColor,
          borderVisible:  true,
          lastValueVisible: false,
          priceLineVisible: false,
          title: isPost ? "AH" : "PM",
        });

        ehSeries.setData([{
          time:  nextDay as unknown as UTCTimestamp,
          open:  prevClose,
          close: ehPrice,
          high:  Math.max(prevClose, ehPrice),
          low:   Math.min(prevClose, ehPrice),
        }]);
      }
    }

    if (patternOverlays.length > 0 && formattedData.length >= 2) {
      const lastBar  = formattedData[formattedData.length - 1];
      const stub5Bar = formattedData[Math.max(0, formattedData.length - 6)];

      for (const overlay of patternOverlays) {
        for (const line of overlay.lines) {
          const validPts = line.points.filter(p => p.price > 0 && isFinite(p.price));
          if (validPts.length < 2) continue;
          const ls = chart.addSeries(LineSeries, {
            color: line.color,
            lineWidth: (line.style === "dotted") ? 1 : 2,
            lineStyle: LS_MAP[line.style] ?? LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            title: line.label ?? "",
          });
          ls.setData(validPts.map(p => ({ time: p.date, value: p.price })));
        }

        const isBullish = overlay.type === "bull-flag" || overlay.type === "ascending-triangle";
        for (const target of overlay.targets) {
          if (!target.price || !isFinite(target.price) || target.price <= 0) continue;
          let color: string;
          let lineStyle: LineStyle;
          if (target.role === "stop") {
            color = "rgba(239,68,68,0.65)";
            lineStyle = LineStyle.Dotted;
          } else if (target.role === "target") {
            color = isBullish ? "rgba(34,197,94,0.75)" : "rgba(239,68,68,0.75)";
            lineStyle = LineStyle.Dashed;
          } else {
            color = "rgba(251,191,36,0.80)";
            lineStyle = LineStyle.Dotted;
          }
          const ts = chart.addSeries(LineSeries, {
            color,
            lineWidth: 1,
            lineStyle,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false,
            title: target.label,
          });
          ts.setData([
            { time: stub5Bar.time, value: target.price },
            { time: lastBar.time,  value: target.price },
          ]);
        }
      }
    }

    if (signals.length > 0) {
      const dataTimeSet = new Set(formattedData.map(d => String(d.time)));
      const markers = signals
        .filter(s => dataTimeSet.has(s.date))
        .map(s => ({
          time: s.date,
          position: s.direction === "bull" ? ("belowBar" as const) : ("aboveBar" as const),
          color: s.direction === "bull"
            ? (s.strength === "strong" ? "#16a34a" : "#22c55e")
            : (s.strength === "strong" ? "#dc2626" : "#ef4444"),
          shape: s.direction === "bull" ? ("arrowUp" as const) : ("arrowDown" as const),
          text: s.label,
          size: s.strength === "strong" ? 2 : 1,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));

      if (markers.length > 0) {
        createSeriesMarkers(candlestickSeries, markers);
      }
    }

    if (showSwingPoints && formattedData.length > swingLookback * 2 + 1) {
      const swings = computeSwingPoints(formattedData, swingLookback);
      const swingMarkers = swings.map(s => ({
        time: typeof s.time === "number"
          ? new Date((s.time as number) * 1000).toISOString().split("T")[0]
          : String(s.time),
        position: s.direction === "high" ? ("aboveBar" as const) : ("belowBar" as const),
        color: s.direction === "high"
          ? "rgba(239,68,68,0.60)"
          : "rgba(34,197,94,0.60)",
        shape: "circle" as const,
        text: "",
        size: 0.8,
      }));
      if (swingMarkers.length > 0) {
        createSeriesMarkers(candlestickSeries, swingMarkers);
      }
    }

    const sigMap = new Map<string, ChartSignalMarker[]>();
    for (const s of signals) {
      const arr = sigMap.get(s.date) ?? [];
      arr.push(s);
      sigMap.set(s.date, arr);
    }

    chart.subscribeCrosshairMove((param) => {
      const el = tooltipRef.current;
      if (el) {
        if (!param.time || !param.point) { el.style.display = "none"; }
        else {
          const dateStr = typeof param.time === "number"
            ? new Date((param.time as number) * 1000).toISOString().slice(0, 10)
            : String(param.time);
          const sigs = sigMap.get(dateStr);
          if (!sigs?.length) { el.style.display = "none"; }
          else {
            const w = chartContainerRef.current?.clientWidth ?? 600;
            const tx = param.point.x + 250 > w ? param.point.x - 258 : param.point.x + 8;
            el.innerHTML =
              `<div style="color:hsl(215,16%,42%);font-size:9px;letter-spacing:.08em;margin-bottom:5px;text-transform:uppercase">${dateStr}</div>` +
              sigs.map(s => {
                const c = s.direction === "bull" ? "#22c55e" : "#ef4444";
                return `<div style="color:${c};margin-bottom:3px"><span style="font-weight:700">${s.label}</span> <span style="color:hsl(215,16%,52%);font-weight:400">${describeSignal(s.label)}</span></div>`;
              }).join("");
            el.style.left = `${tx}px`;
            el.style.top  = `${Math.max(8, param.point.y - 25)}px`;
            el.style.display = "block";
          }
        }
      }

      if (activeToolRef.current !== "pointer") paintCanvas();
    });

    chart.subscribeClick((param) => {
      const tool = activeToolRef.current;

      if (tool === "pointer") {
        if (onCandleClick && param.time && seriesRef.current) {
          const barData = param.seriesData.get(seriesRef.current) as CandlestickData | undefined;
          if (barData) {
            const dateStr = toDateString(param.time as UTCTimestamp | string);
            onCandleClick(dateStr, barData.close);
          }
        }
        return;
      }

      if (!param.point || !param.time) return;
      const price = candlestickSeries.coordinateToPrice(param.point.y);
      const timeStr = timeToString(param.time);
      if (price == null || !timeStr) return;
      const clickPt = { time: timeStr, price };

      if (tool === "hline") {
        onDrawingsChange?.([...drawingsRef.current, {
          id: `d_${Date.now()}`,
          type: "hline",
          color: TOOL_COLORS.hline,
          p1: clickPt,
          p2: null,
        }]);
        return;
      }

      if (!pendingRef.current) {
        pendingRef.current = {
          id: `d_${Date.now()}`,
          type: tool as "trendline" | "ray" | "rectangle",
          color: TOOL_COLORS[tool],
          p1: clickPt,
          p2: null,
        };
      } else {
        const completed: DrawingObject = { ...pendingRef.current, p2: clickPt };
        pendingRef.current = null;
        onDrawingsChange?.([...drawingsRef.current, completed]);
      }
      paintCanvas();
    });

    chart.timeScale().subscribeVisibleTimeRangeChange(paintCanvas);

    const resizeCanvas = () => {
      const canvas = drawingCanvasRef.current;
      const container = chartContainerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = container.clientWidth * dpr;
      canvas.height = height * dpr;
      canvas.style.width  = container.clientWidth + "px";
      canvas.style.height = height + "px";
      paintCanvas();
    };
    resizeCanvas();

    chart.timeScale().fitContent();

    chartRef.current   = chart;
    seriesRef.current  = candlestickSeries;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
      resizeCanvas();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        pendingRef.current = null;
        paintCanvas();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (activeToolRef.current === "pointer") return;
      const container = chartContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = candlestickSeries.coordinateToPrice(y);
      const time  = chart.timeScale().coordinateToTime(x);
      const timeStr = timeToString(time);
      if (price != null && timeStr) {
        hoverRef.current = { time: timeStr, price };
      }
      paintCanvas();
    };

    const handleMouseLeave = () => {
      hoverRef.current = null;
      paintCanvas();
    };

    const container = chartContainerRef.current;
    container?.addEventListener("mousemove", handleMouseMove);
    container?.addEventListener("mouseleave", handleMouseLeave);

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      container?.removeEventListener("mousemove", handleMouseMove);
      container?.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, [data, height, priceLines, signals, showSwingPoints, swingLookback, patternOverlays, extendedHours, scoreOverlay, lineSeries, paintCanvas]);

  useEffect(() => {
    drawingsRef.current  = drawings;
    activeToolRef.current = activeTool;
    pendingRef.current   = null;
    paintCanvas();
  }, [drawings, activeTool, paintCanvas]);

  const isDrawing = activeTool !== "pointer";

  return (
    <div
      className="w-full relative"
      style={{ height, cursor: isDrawing ? "crosshair" : onCandleClick ? "crosshair" : "default" }}
    >
      <div ref={chartContainerRef} style={{ width: "100%", height: "100%" }} />
      <canvas
        ref={drawingCanvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 5,
        }}
      />
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "absolute",
          zIndex: 10,
          background: "hsl(222,18%,8%)",
          border: "1px solid hsl(222,15%,22%)",
          borderRadius: "5px",
          padding: "8px 11px",
          fontSize: "11px",
          fontFamily: "'JetBrains Mono','Fira Code',monospace",
          pointerEvents: "none",
          minWidth: "190px",
          maxWidth: "290px",
          lineHeight: "1.65",
          boxShadow: "0 6px 20px rgba(0,0,0,.55)",
        }}
      />
    </div>
  );
}
