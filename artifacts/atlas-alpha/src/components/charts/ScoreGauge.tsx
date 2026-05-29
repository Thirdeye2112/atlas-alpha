import React from "react";
import { cn } from "@/lib/utils";

interface ScoreGaugeProps {
  score: number;
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export default function ScoreGauge({ score, className, size = 200, strokeWidth = 16 }: ScoreGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // 75% of circle is arc
  const arcLength = circumference * 0.75;
  const gapLength = circumference * 0.25;
  const strokeDasharray = `${arcLength} ${gapLength}`;
  const strokeDashoffset = arcLength - (score / 100) * arcLength;

  let colorClass = "text-destructive";
  if (score >= 80) colorClass = "text-success";
  else if (score >= 60) colorClass = "text-success/80";
  else if (score >= 40) colorClass = "text-muted-foreground";
  else if (score >= 20) colorClass = "text-warning";

  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-225"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-muted fill-none"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcLength} ${gapLength}`}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={cn("fill-none transition-all duration-1000 ease-out", colorClass, "stroke-current")}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center pt-4">
        <span className={cn("font-display font-bold leading-none tracking-tight", colorClass)} style={{ fontSize: size * 0.35 }}>
          {Math.round(score)}
        </span>
        <span className="text-muted-foreground font-mono text-sm mt-1 uppercase tracking-widest">
          Score
        </span>
      </div>
    </div>
  );
}
