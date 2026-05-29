import React from "react";
import { AreaChart, Area, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";

interface Props {
  value: number;
  height?: number;
}

export default function RsiMiniChart({ value, height = 60 }: Props) {
  // Just showing a fake history ending with the current value for visual effect, 
  // since we only get the current RSI from the API in the analysis.
  // In a real app we'd extract RSI history.
  const fakeData = Array.from({ length: 20 }).map((_, i) => ({
    value: i === 19 ? value : 30 + Math.random() * 40
  }));

  let color = "hsl(var(--primary))";
  if (value >= 70) color = "hsl(var(--destructive))"; // Overbought
  if (value <= 30) color = "hsl(var(--success))"; // Oversold

  return (
    <div style={{ height, width: "100%" }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={fakeData}>
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={70} stroke="hsl(var(--destructive))" strokeDasharray="3 3" opacity={0.5} />
          <ReferenceLine y={30} stroke="hsl(var(--success))" strokeDasharray="3 3" opacity={0.5} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fill={color}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="absolute right-0 top-0 text-xs font-mono font-bold" style={{ color }}>
        {value.toFixed(1)}
      </div>
    </div>
  );
}
