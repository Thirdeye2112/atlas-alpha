export const formatCurrency = (value: number | null | undefined, precision = 2) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
};

export const formatPercent = (value: number | null | undefined, precision = 2, divideBy100 = false) => {
  if (value === null || value === undefined) return "-";
  const num = divideBy100 ? value / 100 : value;
  // If the value is tiny and we want percentage, let's just format carefully
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(precision)}%`;
};

export const formatNumber = (value: number | null | undefined, compact = false) => {
  if (value === null || value === undefined) return "-";
  if (compact) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
};

export const getColorForScore = (score: number) => {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-success/70";
  if (score >= 40) return "text-muted-foreground";
  if (score >= 20) return "text-warning";
  return "text-destructive";
};

export const getBgColorForScore = (score: number) => {
  if (score >= 80) return "bg-success";
  if (score >= 60) return "bg-success/70";
  if (score >= 40) return "bg-muted";
  if (score >= 20) return "bg-warning";
  return "bg-destructive";
};

export const getColorForDirection = (dir: string | null | undefined) => {
  if (!dir) return "text-muted-foreground";
  const lower = dir.toLowerCase();
  if (lower.includes("bull")) return "text-success";
  if (lower.includes("bear")) return "text-destructive";
  return "text-muted-foreground";
};
