import { useEffect, useRef } from "react";
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
} from "lightweight-charts";
import { OHLCVBar } from "@workspace/api-client-react";

export interface ChartPriceLine {
  price: number;
  label: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
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

interface Props {
  data: OHLCVBar[];
  height?: number;
  onCandleClick?: (date: string, close: number) => void;
  priceLines?: ChartPriceLine[];
  signals?: ChartSignalMarker[];
  extendedHours?: ExtendedHoursPoint;
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

/** Advance a YYYY-MM-DD date string by N calendar days, skipping weekends. */
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

export default function LightweightChart({
  data,
  height = 400,
  onCandleClick,
  priceLines = [],
  signals = [],
  extendedHours,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

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
      },
      crosshair: {
        mode: 1,
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

    // Volume histogram — bottom 22% of chart, colored by candle direction
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
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

    // Moving average lines — SMA50, SMA87, SMA200 — computed from bar data, full-width
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
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title,
      });
      maSeries.setData(maData);
    }

    // Short right-side stubs for BB+/−, VWAP, SUP, RES — last 2 bars only
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
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: pl.label,
        });
        stubSeries.setData([
          { time: prevBar.time, value: pl.price },
          { time: lastBar.time, value: pl.price },
        ]);
      }
    }

    // ── Extended hours price point ────────────────────────────────────────────
    // When pre/post market data is available, plot a projected price dot at
    // the next trading day and draw a dashed horizontal price line across the chart.
    if (extendedHours && formattedData.length > 0) {
      const lastBar = formattedData[formattedData.length - 1];
      const lastDateStr = toDateString(lastBar.time);
      // Only show on daily timeframes (date strings, not intraday timestamps)
      const isDaily = typeof lastBar.time === "string" || String(lastBar.time).length === 10;
      if (isDaily || typeof lastBar.time === "string") {
        const nextDay = nextTradingDay(lastDateStr);
        const isPost = extendedHours.type === "post";
        const ehColor = isPost ? "#f59e0b" : "#818cf8"; // amber = post, indigo = pre
        const chgSign = extendedHours.changePercent >= 0 ? "+" : "";
        const label = `${isPost ? "AH" : "PM"} ${chgSign}${extendedHours.changePercent.toFixed(2)}%`;

        // Dashed horizontal price line spanning the last 2 real bars + next day
        const ehLineSeries = chart.addSeries(LineSeries, {
          color: ehColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 5,
          title: label,
        });

        const prev2Bar = formattedData.length >= 2
          ? formattedData[formattedData.length - 2]
          : lastBar;

        ehLineSeries.setData([
          { time: prev2Bar.time, value: extendedHours.price },
          { time: lastBar.time,  value: extendedHours.price },
          { time: nextDay as unknown as UTCTimestamp,       value: extendedHours.price },
        ]);
      }
    }

    // Signal markers — only meaningful on daily bars (date strings)
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

    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    if (onCandleClick) {
      chart.subscribeClick((param) => {
        if (!param.time || !seriesRef.current) return;
        const barData = param.seriesData.get(seriesRef.current) as CandlestickData | undefined;
        if (!barData) return;
        const dateStr = toDateString(param.time as UTCTimestamp | string);
        onCandleClick(dateStr, barData.close);
      });
    }

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [data, height, onCandleClick, priceLines, signals, extendedHours]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full"
      style={{ height, cursor: onCandleClick ? "crosshair" : "default" }}
    />
  );
}
