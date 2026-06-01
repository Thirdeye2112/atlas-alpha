export const SCANNER_UNIVERSE: string[] = [
  // ── Mega-cap Tech & Communication ─────────────────────────────────────────
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL", "NFLX",
  "CRM", "ADBE", "AMD", "QCOM", "INTC", "TXN", "AMAT", "LRCX", "KLAC", "SNPS",
  "CDNS", "NOW", "PANW", "CRWD", "MU", "ANET", "INTU", "IBM", "CSCO", "ACN",
  "DIS", "CMCSA", "T", "VZ", "TMUS",

  // ── Mid-cap Technology & Software ─────────────────────────────────────────
  "MRVL", "ON", "SMCI", "ARM", "NET", "DDOG", "ZS", "OKTA", "TEAM", "WDAY",
  "VEEV", "KEYS", "TER", "SWKS", "MPWR", "ENTG", "ENPH", "FSLR", "SEDG",
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

  // ═══════════════════════════════════════════════════════════════════════════
  // ── S&P 500 COMPLETIONS ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Financials ────────────────────────────────────────────────────────────
  "BRK-B",                                         // Berkshire Hathaway
  "BX", "APO", "KKR", "CG",                       // Private equity / alternatives
  "FITB", "HBAN", "KEY", "RF", "CFG", "MTB",      // Regional banks
  "BK", "STT", "NTRS",                             // Custody / trust banks
  "TROW", "IVZ", "BEN",                            // Asset managers
  "AIZ", "L", "HIG", "AON", "FNF", "VOYA", "PFG", "WRB", "ACGL", // Insurance
  "NDAQ", "RJF",                                   // Exchanges / wealth mgmt

  // ── Communication Services ────────────────────────────────────────────────
  "CHTR",                                          // Cable / broadband
  "WBD", "PARA", "NWSA", "FOX",                   // Media
  "LYV",                                           // Live events
  "EA", "TTWO",                                    // Video games
  "OMC", "IPG",                                    // Advertising agencies

  // ── Consumer Discretionary ────────────────────────────────────────────────
  "YUM", "CMG", "DPZ", "QSR", "DRI",              // Restaurants
  "APTV", "KMX", "AN",                             // Auto & dealers
  "PHM", "TOL", "NVR",                             // Homebuilders
  "BBY", "DLTR", "GPC",                            // Specialty retail
  "LVS", "WYNN", "CZR", "NCLH",                   // Gaming & cruise
  "RL", "PVH", "TPR",                              // Apparel / luxury
  "HAS",                                           // Toys

  // ── Consumer Staples ──────────────────────────────────────────────────────
  "MKC", "CAG", "CPB", "HRL", "SJM", "CHD",       // Food / household
  "WBA", "TAP",                                    // Drug retail / beverages
  "KVUE",                                          // Kenvue (J&J spin-off)

  // ── Energy ────────────────────────────────────────────────────────────────
  "MRO",                                           // Marathon Oil
  "OKE", "TRGP",                                  // Midstream
  "LNG",                                           // Cheniere (LNG exports)
  "EQT",                                           // Natural gas E&P

  // ── Healthcare ────────────────────────────────────────────────────────────
  "ELV", "CNC", "MOH",                             // Managed care
  "HOLX", "HSIC", "MTD", "RMD", "COO", "CRL", "RVTY", // Devices / diagnostics
  "VTRS", "INCY", "OGN", "UTHR", "ALNY",          // Pharma / biotech
  "A", "AVTR",                                     // Life science tools

  // ── Industrials & Defense ─────────────────────────────────────────────────
  "DAL", "UAL", "AAL", "LUV",                      // Airlines
  "EXPD", "JBHT", "CHRW", "XPO", "GXO",           // Freight & logistics
  "LHX", "TDG", "HEI", "TXT",                     // Aerospace / defense
  "PH", "DOV", "AME", "IEX", "FTV", "GNRC", "ALLE", "SWK", "BWA", // Industrials
  "PWR", "MTZ", "J", "HUBB",                      // Construction / infra
  "BALL", "IP", "PKG", "CCK",                      // Packaging
  "AXON",                                          // Public safety / security

  // ── Information Technology ────────────────────────────────────────────────
  "HPQ", "HPE", "DELL", "WDC", "NTAP", "CDW",     // Hardware / storage
  "NXPI", "MCHP",                                  // Semiconductors (Nasdaq-100)
  "FTNT", "AKAM", "FFIV", "GRMN",                 // Networking / security
  "ROP", "TYL", "PAYC", "HUBS", "MANH", "IT",    // Enterprise software
  "CTSH", "EPAM", "GDDY",                          // IT services
  "FICO", "TRMB", "ZBRA",                          // Analytics / decisioning
  "PSTG", "GEN",                                   // Storage / security software
  "LDOS",                                          // Defense IT services

  // ── Materials ─────────────────────────────────────────────────────────────
  "CTVA", "FMC",                                   // Ag chemicals
  "CE", "EMN", "RPM", "OLN", "HUN", "WLK",        // Specialty chemicals
  "ATI",                                           // Specialty metals
  "SEE", "SON", "AVY",                             // Packaging
  "VMC", "MLM",                                    // Aggregates / construction mats

  // ── Real Estate ───────────────────────────────────────────────────────────
  "EXR", "KIM", "BXP", "VNO", "IRM",              // Storage / office / retail REITs
  "CPT", "CUBE", "UDR",                            // Residential / storage
  "INVH", "AMH",                                   // Single-family rental
  "VICI", "GLPI",                                  // Gaming REITs
  "ELS", "SUI",                                    // Manufactured housing

  // ── Utilities ─────────────────────────────────────────────────────────────
  "ES", "CNP", "CMS", "NI", "LNT", "PNW",         // Electric / gas utilities
  "NRG", "EIX", "AEE", "FE", "PPL", "ETR", "PEG", "AES",
  "CEG", "VST",                                    // Clean / nuclear power gen

  // ═══════════════════════════════════════════════════════════════════════════
  // ── RUSSELL 1000 NOTABLE MID-CAPS ─────────────────────────────────────────
  // High-growth names outside the S&P 500 core. Elevated gap frequency makes
  // them ideal for gap-setup and short-squeeze scans.
  // ═══════════════════════════════════════════════════════════════════════════

  // High-growth Tech
  "APP",   // AppLovin — digital advertising
  "DUOL",  // Duolingo — edtech
  "MNDY",  // Monday.com — work OS
  "TOST",  // Toast — restaurant tech
  "DT",    // Dynatrace — observability
  "PATH",  // UiPath — RPA automation
  "MDB",   // MongoDB — database
  "CFLT",  // Confluent — data streaming
  "GTLB",  // GitLab — DevSecOps
  "DOCS",  // Doximity — medical networking
  "BILL",  // Bill.com — SMB payments
  "ZI",    // ZoomInfo — B2B data
  "BRZE",  // Braze — customer engagement
  "TTD",   // The Trade Desk — programmatic ads
  "SMAR",  // Smartsheet — collaborative work

  // Consumer / Retail mid-caps
  "DKNG",  // DraftKings — sports betting
  "CAVA",  // CAVA Group — fast casual
  "CELH",  // Celsius Holdings — energy drinks
  "HIMS",  // Hims & Hers Health
  "RDDT",  // Reddit — social media
  "AFRM",  // Affirm — BNPL payments
  "CART",  // Maplebear (Instacart)

  // Healthcare / Biotech mid-caps
  "NTRA",  // Natera — genetic testing
  "PCVX",  // Vaxcyte — vaccines
  "RXRX",  // Recursion Pharma — AI drug discovery

  // Clean energy mid-caps
  "RUN",   // Sunrun — residential solar
  "BE",    // Bloom Energy — fuel cells

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

// ── Asset-type metadata ────────────────────────────────────────────────────

export type AssetType =
  | "equity"
  | "etf"
  | "leveraged-etf"
  | "volatility-etf"
  | "bond-etf"
  | "commodity-etf"
  | "international-etf";

/** Explicit overrides — everything else is classified via getAssetType(). */
export const UNIVERSE_METADATA: Readonly<Record<string, AssetType>> = {
  // Leveraged / inverse (2× or 3× daily reset — structural decay)
  TQQQ: "leveraged-etf", SQQQ: "leveraged-etf",
  UPRO: "leveraged-etf", SPXU: "leveraged-etf",
  SSO:  "leveraged-etf", SDS:  "leveraged-etf",
  DDM:  "leveraged-etf", DXD:  "leveraged-etf",
  TMF:  "leveraged-etf", TBT:  "leveraged-etf",

  // Volatility products (VIX futures — persistent contango drag)
  VXX: "volatility-etf", UVXY: "volatility-etf", SVXY: "volatility-etf",

  // Fixed-income ETFs
  TLT: "bond-etf", IEF: "bond-etf", SHY: "bond-etf",
  AGG: "bond-etf", BND: "bond-etf",
  LQD: "bond-etf", HYG: "bond-etf", JNK: "bond-etf",

  // Commodity ETFs
  GLD: "commodity-etf", SLV: "commodity-etf",
  GDX: "commodity-etf", GDXJ: "commodity-etf",
  USO: "commodity-etf", UNG: "commodity-etf",

  // International / emerging-market ETFs
  EEM: "international-etf", IEMG: "international-etf",
  EFA: "international-etf", VEA:  "international-etf",
  ARKK: "international-etf",
};

const BROAD_ETF_SET = new Set<string>([
  "SPY","IVV","VOO","RSP","OEF","SPYG","SPYV",
  "QQQ","QQQM","ONEQ","QQEW","DIA",
  "IWM","IWB","IWV","IWF","IWD","IWO","IWN",
  "MDY","IJH","IJR","SPSM","VTI","ITOT","SCHB",
  "VUG","VTV","MGC","MGK","MGV",
  "EUSA","QUAL","MTUM","VLUE","SIZE",
  "XLK","XLF","XLE","XLV","XLP","XLI","XLY","XLU","XLB","XLRE","XLC",
  "VGT","VFH","VDE","VHT","VDC","VIS","VCR","VPU","VAW",
]);

/** Returns the asset type for any ticker in the universe. */
export function getAssetType(ticker: string): AssetType {
  return UNIVERSE_METADATA[ticker] ?? (BROAD_ETF_SET.has(ticker) ? "etf" : "equity");
}

/**
 * Returns true for tickers with structurally distorted price dynamics:
 * leveraged daily-reset decay or VIX futures contango drag.
 * These should carry disclaimers in the scanner and use caution in backtests.
 */
export function isStructurallyDistorted(ticker: string): boolean {
  const t = UNIVERSE_METADATA[ticker];
  return t === "leveraged-etf" || t === "volatility-etf";
}
