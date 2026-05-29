import React from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  score: number;
}

export default function MiniGauge({ title, score }: Props) {
  let colorClass = "bg-destructive";
  if (score >= 80) colorClass = "bg-success";
  else if (score >= 60) colorClass = "bg-success/70";
  else if (score >= 40) colorClass = "bg-muted-foreground";
  else if (score >= 20) colorClass = "bg-warning";

  return (
    <div className="flex flex-col gap-1.5 bg-card border border-border p-3 rounded-md">
      <div className="flex justify-between items-center text-xs font-mono text-muted-foreground uppercase">
        <span>{title}</span>
        <span className="font-bold text-foreground">{Math.round(score)}</span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", colorClass)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
