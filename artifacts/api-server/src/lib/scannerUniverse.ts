export const SCANNER_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK.B", "LLY", "V",
  "JPM", "UNH", "XOM", "AVGO", "MA", "HD", "PG", "JNJ", "COST", "MRK",
  "ABBV", "CRM", "CVX", "NFLX", "AMD", "WMT", "KO", "BABA", "PEP", "BAC",
  "TMO", "ORCL", "ADBE", "MCD", "CSCO", "ABT", "WFC", "INTC", "DIS", "GS",
  "MS", "RTX", "INTU", "AMGN", "QCOM", "TXN", "UBER", "NEE", "IBM", "PM",
  "SPGI", "AMAT", "GE", "T", "AXP", "PFE", "CAT", "LRCX", "NOW", "SYK",
  "BLK", "ISRG", "MDT", "BKNG", "VRTX", "C", "PANW", "SNPS", "KLAC", "MELI",
  "CDNS", "SO", "AMT", "ZTS", "PLD", "REGN", "GILD", "MO", "USB", "BSX",
  "HCA", "CI", "SCHW", "CL", "BDX", "TJX", "DE", "EOG", "NOC", "MMC",
  "PLTR", "SOFI", "RIVN", "GME", "AMC", "BBBY", "MSTR", "COIN", "RBLX", "U",
  "SQ", "SHOP", "SNOW", "NET", "DDOG", "CRWD", "ZM", "ROKU", "PTON", "LYFT",
  "HOOD", "IONQ", "SMCI", "ARM", "MRVL", "ON", "ENPH", "FSLR", "SEDG", "PLUG",
  "SPY", "QQQ", "IWM", "GLD", "SLV", "TLT", "HYG", "EEM", "IEMG", "ARKK",
];

export const SP500_UNIVERSE = SCANNER_UNIVERSE.filter(t => !["SPY", "QQQ", "IWM", "GLD", "SLV", "TLT", "HYG", "EEM", "IEMG", "ARKK"].includes(t));
