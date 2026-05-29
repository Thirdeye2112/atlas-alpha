export const SCANNER_UNIVERSE: string[] = [
  // ── Mega-cap Tech & Communication ─────────────────────────────────────────
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL", "NFLX",
  "CRM", "ADBE", "AMD", "QCOM", "INTC", "TXN", "AMAT", "LRCX", "KLAC", "SNPS",
  "CDNS", "NOW", "PANW", "CRWD", "MU", "ANET", "INTU", "IBM", "CSCO", "ACN",
  "DIS", "CMCSA", "T", "VZ", "TMUS",

  // ── Mid-cap Technology & Software ─────────────────────────────────────────
  "MRVL", "ON", "SMCI", "ARM", "NET", "DDOG", "ZS", "OKTA", "TEAM", "WDAY",
  "VEEV", "ANSS", "KEYS", "TER", "SWKS", "MPWR", "ENTG", "ENPH", "FSLR", "SEDG",
  "SHOP", "ZM", "ROKU", "RBLX", "U", "LYFT", "UBER", "GRAB",

  // ── Fintech / Crypto-adjacent ──────────────────────────────────────────────
  "PYPL", "SQ", "COIN", "MSTR", "HOOD", "SOFI", "NU",

  // ── Financials — Banks, Insurance, Asset Managers ─────────────────────────
  "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "SCHW", "USB",
  "PNC", "TFC", "COF", "DFS", "ALL", "CB", "PGR", "TRV", "MET", "PRU",
  "CME", "ICE", "CBOE", "SPGI", "MCO", "V", "MA", "AJG", "MMC", "WTW",

  // ── Healthcare — Pharma, Biotech, MedTech ─────────────────────────────────
  "JNJ", "UNH", "LLY", "MRK", "ABBV", "TMO", "ABT", "AMGN", "GILD", "VRTX",
  "REGN", "MDT", "BSX", "SYK", "ISRG", "HCA", "CI", "ZTS", "BDX", "EW",
  "IQV", "DHR", "IDXX", "ALGN", "MRNA", "BIIB", "PFE", "BMY", "HUM", "CVS",
  "MCK", "CAH", "COR", "BAX", "DXCM", "PODD", "GEHC",

  // ── Consumer Discretionary ────────────────────────────────────────────────
  "HD", "MCD", "NKE", "SBUX", "LOW", "TGT", "TJX", "ROST", "BKNG", "MELI",
  "ORLY", "AZO", "F", "GM", "RIVN", "DHI", "LEN", "TSCO", "ULTA", "LULU",
  "EBAY", "ABNB", "DASH", "EXPE", "MAR", "HLT", "CCL", "RCL", "MGM",

  // ── Consumer Staples ──────────────────────────────────────────────────────
  "WMT", "KO", "PEP", "PG", "PM", "MO", "COST", "CL", "GIS", "KHC",
  "MDLZ", "STZ", "HSY", "CLX", "EL", "MNST", "KR", "SYY", "TSN",

  // ── Energy ────────────────────────────────────────────────────────────────
  "XOM", "CVX", "COP", "EOG", "SLB", "OXY", "DVN", "HAL", "MPC", "VLO",
  "PSX", "KMI", "WMB", "FANG", "CTRA", "APA", "HES", "BKR",

  // ── Industrials & Defense ─────────────────────────────────────────────────
  "CAT", "DE", "HON", "UPS", "FDX", "LMT", "RTX", "NOC", "GD", "BA",
  "GE", "MMM", "ETN", "EMR", "ROK", "TT", "CARR", "OTIS", "WM", "RSG",
  "VRSK", "BR", "FAST", "CTAS", "ADP", "PAYX", "EFX", "CPRT", "ODFL",

  // ── Materials ─────────────────────────────────────────────────────────────
  "LIN", "APD", "SHW", "ECL", "NEM", "FCX", "NUE", "MOS", "CF", "ALB",
  "DD", "DOW", "PPG", "IFF",

  // ── Utilities ─────────────────────────────────────────────────────────────
  "NEE", "DUK", "SO", "D", "SRE", "AEP", "EXC", "XEL", "WEC", "AWK",

  // ── REITs ─────────────────────────────────────────────────────────────────
  "PLD", "AMT", "EQIX", "CCI", "SBAC", "DLR", "PSA", "EQR", "AVB", "O",
  "VTR", "WELL", "SPG", "MAA", "ARE",

  // ── High-momentum / Speculative ───────────────────────────────────────────
  "PLTR", "IONQ", "GME", "AMC", "PTON", "PLUG", "RKLB", "JOBY", "SNOW",

  // ── China / Emerging ──────────────────────────────────────────────────────
  "BABA", "JD", "PDD", "BIDU", "NIO",

  // ── US Broad-Market Index ETFs ────────────────────────────────────────────
  // S&P 500
  "SPY", "IVV", "VOO", "RSP", "OEF", "SPYG", "SPYV",
  // Nasdaq
  "QQQ", "QQQM", "ONEQ", "QQEW",
  // Dow Jones
  "DIA",
  // Russell
  "IWM", "IWB", "IWV", "IWF", "IWD", "IWO", "IWN",
  // S&P 400 Mid-Cap
  "MDY", "IJH",
  // S&P 600 Small-Cap
  "IJR", "SPSM",
  // Total US Market
  "VTI", "ITOT", "SCHB",
  // Growth / Value
  "VUG", "VTV", "MGC", "MGK", "MGV",
  // Equal-weight & factor
  "EUSA", "QUAL", "MTUM", "VLUE", "SIZE",
  // Volatility
  "VXX", "UVXY", "SVXY",
  // Leveraged index
  "TQQQ", "SQQQ", "UPRO", "SPXU", "SSO", "SDS", "DDM", "DXD",

  // ── Sector ETFs (SPDR + Vanguard) ────────────────────────────────────────
  "XLK", "XLF", "XLE", "XLV", "XLP", "XLI", "XLY", "XLU", "XLB", "XLRE", "XLC",
  "VGT", "VFH", "VDE", "VHT", "VDC", "VIS", "VCR", "VPU", "VAW",

  // ── Commodities & Bonds ───────────────────────────────────────────────────
  "GLD", "SLV", "GDX", "GDXJ", "USO", "UNG",
  "TLT", "TBT", "TMF", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "JNK",

  // ── International & Emerging ─────────────────────────────────────────────
  "EEM", "IEMG", "EFA", "VEA", "ARKK",
];
