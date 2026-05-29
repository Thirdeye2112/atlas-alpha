export type CalibrationStatus = "none" | "pending" | "fitted" | "error";

export interface CalibrationEntry {
  ticker: string;
  slope: number;
  intercept: number;
  calibratedProbability: (score: number) => number;
  observations: number;
  horizon: number;
  rankIC: number;
  icRating: string;
  fittedAt: string;
}

type StoreValue = { status: "pending" | "error" } | ({ status: "fitted" } & CalibrationEntry);

const store = new Map<string, StoreValue>();
let pendingCount = 0;
const MAX_CONCURRENT = 2;

export const calibrationStore = {
  get(ticker: string): StoreValue | undefined {
    return store.get(ticker.toUpperCase());
  },

  set(ticker: string, entry: CalibrationEntry): void {
    const sym = ticker.toUpperCase();
    const prev = store.get(sym);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(sym, { status: "fitted", ...entry });
  },

  markPending(ticker: string): boolean {
    const sym = ticker.toUpperCase();
    if (store.has(sym)) return false;          // already tracked
    if (pendingCount >= MAX_CONCURRENT) return false; // too busy
    pendingCount++;
    store.set(sym, { status: "pending" });
    return true;
  },

  markError(ticker: string): void {
    const sym = ticker.toUpperCase();
    const prev = store.get(sym);
    if (prev?.status === "pending") pendingCount = Math.max(0, pendingCount - 1);
    store.set(sym, { status: "error" });
  },

  status(ticker: string): CalibrationStatus {
    const entry = store.get(ticker.toUpperCase());
    return entry?.status ?? "none";
  },

  getFitted(ticker: string): CalibrationEntry | null {
    const entry = store.get(ticker.toUpperCase());
    if (entry?.status === "fitted") return entry;
    return null;
  },
};
