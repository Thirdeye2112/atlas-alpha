import React from "react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

interface Props {
  data: number[];
  color?: string;
  height?: number;
}

export default function Sparkline({ data, color = "hsl(var(--primary))", height = 40 }: Props) {
  const chartData = data.map((value, i) => ({ value, index: i }));
  const min = Math.min(...data);
  const max = Math.max(...data);

  return (
    <div style={{ height, width: "100%" }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <YAxis domain={[min, max]} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
