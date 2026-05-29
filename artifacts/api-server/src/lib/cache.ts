import NodeCache from "node-cache";

export const quoteCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
export const analysisCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
export const scannerCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });
export const ohlcvCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
export const marketCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
