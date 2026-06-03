export const SCANNER_UNIVERSE: string[] = [
  // ── Mega-cap Tech & Communication ─────────────────────────────────────────
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "ORCL", "NFLX",
  "CRM", "ADBE", "AMD", "QCOM", "INTC", "TXN", "AMAT", "LRCX", "KLAC", "SNPS",
  "CDNS", "NOW", "PANW", "CRWD", "MU", "ANET", "INTU", "IBM", "CSCO", "ACN",
  "DIS", "CMCSA", "T", "VZ", "TMUS",

  // ── Mid-cap Technology & Software ─────────────────────────────────────────
  "MRVL", "ON", "ARM", "NET", "DDOG", "ZS", "OKTA", "TEAM", "WDAY",
  "VEEV", "KEYS", "TER", "SWKS", "MPWR", "ENTG", "ENPH", "FSLR",
  "SHOP", "ZM", "ROKU", "UBER",

  // ── Fintech / Crypto-adjacent ──────────────────────────────────────────────
  "PYPL", "SQ", "COIN", "SOFI",

  // ── Financials — Banks, Insurance, Asset Managers ─────────────────────────
  "JPM", "BAC", "WFC", "GS", "MS", "C", "AXP", "BLK", "SCHW", "USB",
  "PNC", "TFC", "COF", "SYF", "ALLY", "ALL", "CB", "PGR", "TRV", "MET", "PRU",
  "CME", "ICE", "CBOE", "SPGI", "MCO", "V", "MA", "AJG", "WTW",

  // ── Healthcare — Pharma, Biotech, MedTech ─────────────────────────────────
  "JNJ", "UNH", "LLY", "MRK", "ABBV", "TMO", "ABT", "AMGN", "GILD", "VRTX",
  "REGN", "MDT", "BSX", "SYK", "ISRG", "HCA", "CI", "ZTS", "BDX", "EW",
  "IQV", "DHR", "IDXX", "ALGN", "MRNA", "BIIB", "PFE", "BMY", "HUM", "CVS",
  "MCK", "CAH", "COR", "BAX", "DXCM", "PODD", "GEHC",

  // ── Consumer Discretionary ────────────────────────────────────────────────
  "HD", "MCD", "NKE", "SBUX", "LOW", "TGT", "TJX", "ROST", "BKNG", "MELI",
  "ORLY", "AZO", "F", "GM", "DHI", "LEN", "TSCO", "ULTA", "LULU",
  "EBAY", "ABNB", "DASH", "EXPE", "MAR", "HLT", "CCL", "RCL", "MGM",

  // ── Consumer Staples ──────────────────────────────────────────────────────
  "WMT", "KO", "PEP", "PG", "PM", "MO", "COST", "CL", "GIS", "KHC",
  "MDLZ", "STZ", "HSY", "CLX", "EL", "MNST", "KR", "SYY", "TSN",

  // ── Energy ────────────────────────────────────────────────────────────────
  "XOM", "CVX", "COP", "EOG", "SLB", "OXY", "DVN", "HAL", "MPC", "VLO",
  "PSX", "KMI", "WMB", "FANG", "CTRA", "APA", "BKR",

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

  // ── High-growth S&P 500 additions ─────────────────────────────────────────
  "PLTR", "SNOW",

  // ═══════════════════════════════════════════════════════════════════════════
  // ── S&P 500 COMPLETIONS (ROUND 1) ─────────────────────────────────────────
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
  "WBD", "NWSA", "FOX",                            // Media
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
  "TAP",                                           // Beverages
  "KVUE",                                          // Kenvue (J&J spin-off)

  // ── Energy ────────────────────────────────────────────────────────────────
  "PR",                                            // Permian Resources
  "OKE", "TRGP",                                   // Midstream
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
  "CTSH", "GDDY",                                  // IT services
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

  // ── S&P 500 high-growth additions ─────────────────────────────────────────
  "APP",   // AppLovin — S&P 500 digital advertising
  "DT",    // Dynatrace — NASDAQ 100 observability
  "TTD",   // The Trade Desk — NASDAQ 100 programmatic ads

  // ── US Broad-Market Index ETFs ────────────────────────────────────────────
  "SPY", "IVV", "VOO",
  "QQQ",
  "DIA",
  "IWM",
  "VTI",
  "VUG", "VTV",
  "VXX", "UVXY", "SVXY",
  "TQQQ", "SQQQ", "UPRO", "SPXU", "SSO", "SDS", "DDM", "DXD",

  // ── Sector ETFs (SPDR) ────────────────────────────────────────────────────
  "XLK", "XLF", "XLE", "XLV", "XLP", "XLI", "XLY", "XLU", "XLB", "XLRE", "XLC",
  "VGT",

  // ── Commodities & Bonds ───────────────────────────────────────────────────
  "GLD", "SLV", "GDX", "GDXJ", "USO", "UNG",
  "TLT", "TBT", "TMF", "IEF", "SHY", "AGG", "BND", "LQD", "HYG", "JNK",

  // ── International & Emerging ─────────────────────────────────────────────
  "EEM", "EFA",

  // ═══════════════════════════════════════════════════════════════════════════
  // ── S&P 500 / NASDAQ 100 COMPLETIONS (MERGED) ─────────────────────────────
  // Union of all confirmed S&P 500 / NASDAQ 100 members not covered above.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Financials ────────────────────────────────────────────────────────────
  "GOOG",   // Alphabet Class C — NASDAQ 100 (distinct share class from GOOGL)
  "AFL",    // Aflac — S&P 500 supplemental insurance
  "GL",     // Globe Life — S&P 500 life & health insurance
  "UNM",    // Unum Group — S&P 500 employee benefits
  "CMA",    // Comerica — S&P 500 regional bank
  "CINF",   // Cincinnati Financial — S&P 500 P&C insurance
  "FDS",    // FactSet Research — NASDAQ 100 financial data
  "ERIE",   // Erie Indemnity — S&P 500 property & casualty insurance
  "BRO",    // Brown & Brown — S&P 500 insurance brokerage
  "CPAY",   // Corpay — S&P 500 payments
  "EG",     // Everest Group — S&P 500 reinsurance
  "MKTX",   // MarketAxess — S&P 500 bond trading platform
  "WPC",    // W. P. Carey — S&P 500 net-lease REIT
  "ZION",   // Zions Bancorp — S&P 500 regional bank

  // ── Healthcare ────────────────────────────────────────────────────────────
  "TECH",   // Bio-Techne — S&P 500 life science reagents
  "DGX",    // Quest Diagnostics — S&P 500 lab services
  "LH",     // LabCorp — S&P 500 diagnostics
  "XRAY",   // Dentsply Sirona — S&P 500 dental products
  "BIO",    // Bio-Rad Laboratories — S&P 500 life science tools
  "STE",    // STERIS — S&P 500 healthcare sterilization
  "BMRN",   // BioMarin Pharmaceutical — NASDAQ 100 rare disease
  "DVA",    // DaVita — S&P 500 dialysis services
  "ILMN",   // Illumina — NASDAQ 100 genomic sequencing
  "TFX",    // Teleflex — S&P 500 medical devices
  "UHS",    // Universal Health Services — S&P 500 hospitals
  "WAT",    // Waters Corp — S&P 500 analytical instruments
  "WST",    // West Pharma Services — S&P 500 drug delivery
  "ZBH",    // Zimmer Biomet — S&P 500 orthopedic implants

  // ── Technology ────────────────────────────────────────────────────────────
  "ADI",    // Analog Devices — NASDAQ 100 semiconductor
  "ADSK",   // Autodesk — NASDAQ 100 design software
  "ASML",   // ASML Holding — NASDAQ 100 lithography (ADR)
  "APH",    // Amphenol — S&P 500 connectors / sensors
  "CSGP",   // CoStar Group — NASDAQ 100 real estate data
  "FIS",    // Fidelity National Information — S&P 500 payments
  "FISV",   // Fiserv — S&P 500 fintech
  "GPN",    // Global Payments — S&P 500 payment processing
  "JKHY",   // Jack Henry & Associates — S&P 500 banking tech
  "MSCI",   // MSCI Inc — S&P 500 index / analytics
  "PTC",    // PTC Inc — S&P 500 industrial IoT software
  "STX",    // Seagate Technology — NASDAQ 100 hard drives
  "TEL",    // TE Connectivity — S&P 500 connectors
  "VRSN",   // VeriSign — NASDAQ 100 domain registry

  // ── Consumer Discretionary ────────────────────────────────────────────────
  "BBWI",   // Bath & Body Works — S&P 500 specialty retail
  "DG",     // Dollar General — S&P 500 discount retail
  "FIVE",   // Five Below — S&P 500 value retail
  "LKQ",    // LKQ Corp — S&P 500 auto parts
  "MHK",    // Mohawk Industries — S&P 500 flooring
  "MTCH",   // Match Group — S&P 500 dating apps
  "POOL",   // Pool Corp — NASDAQ 100 pool supply distribution
  "RHI",    // Robert Half — S&P 500 staffing
  "SNA",    // Snap-on — S&P 500 professional tools
  "URI",    // United Rentals — S&P 500 equipment rental
  "WSM",    // Williams-Sonoma — S&P 500 home furnishings

  // ── Consumer Staples ──────────────────────────────────────────────────────
  "ADM",    // Archer-Daniels-Midland — S&P 500 ag processing
  "BG",     // Bunge Global — S&P 500 ag commodities
  "KDP",    // Keurig Dr Pepper — NASDAQ 100 beverages
  "KMB",    // Kimberly-Clark — S&P 500 paper products
  "LW",     // Lamb Weston — S&P 500 frozen potato products

  // ── Energy ────────────────────────────────────────────────────────────────

  // ── Industrials ───────────────────────────────────────────────────────────
  "ALK",    // Alaska Air — S&P 500 airline
  "AOS",    // A.O. Smith — S&P 500 water heaters
  "BAH",    // Booz Allen Hamilton — S&P 500 defense consulting
  "CSX",    // CSX Corp — S&P 500 Class I railroad
  "EME",    // EMCOR Group — S&P 500 electrical contractor
  "FLS",    // Flowserve — S&P 500 flow control equipment
  "GWW",    // W.W. Grainger — S&P 500 industrial distribution
  "HII",    // Huntington Ingalls — S&P 500 naval shipbuilding
  "HWM",    // Howmet Aerospace — S&P 500 aerospace structures
  "IR",     // Ingersoll Rand — S&P 500 industrial equipment
  "JCI",    // Johnson Controls — S&P 500 building tech
  "MAS",    // Masco — S&P 500 home improvement products
  "NDSN",   // Nordson — S&P 500 precision dispensing
  "NSC",    // Norfolk Southern — S&P 500 Class I railroad
  "NVT",    // nVent Electric — S&P 500 electrical enclosures
  "OC",     // Owens Corning — S&P 500 insulation / composites
  "PCAR",   // PACCAR — NASDAQ 100 heavy trucks
  "PNR",    // Pentair — S&P 500 water treatment
  "ROL",    // Rollins — S&P 500 pest control
  "RXO",    // RXO Inc — S&P 500 freight brokerage
  "STLD",   // Steel Dynamics — S&P 500 steel mini-mill
  "TDY",    // Teledyne Technologies — S&P 500 defense instruments
  "UNP",    // Union Pacific — S&P 500 Class I railroad
  "WAB",    // Westinghouse Air Brake — S&P 500 rail equipment
  "WHR",    // Whirlpool — S&P 500 home appliances
  "XYL",    // Xylem — S&P 500 water technology

  // ── Materials ─────────────────────────────────────────────────────────────
  "LYB",    // LyondellBasell — S&P 500 petrochemicals
  "RS",     // Reliance Steel & Aluminum — S&P 500 metals service center

  // ── Real Estate ───────────────────────────────────────────────────────────
  "DOC",    // Healthpeak Properties — S&P 500 medical office REIT
  "ESS",    // Essex Property Trust — S&P 500 West Coast apartments
  "HST",    // Host Hotels & Resorts — S&P 500 lodging REIT
  "REG",    // Regency Centers — S&P 500 grocery-anchored REIT

  // ── Utilities ─────────────────────────────────────────────────────────────
  "ATO",    // Atmos Energy — S&P 500 natural gas distribution
  "DTE",    // DTE Energy — S&P 500 Michigan electric/gas
  "ED",     // Consolidated Edison — S&P 500 NYC utility
  "EVRG",   // Evergy — S&P 500 Kansas/Missouri utility
  "PCG",    // PG&E — S&P 500 California electric & gas

  // ── Communication Services ────────────────────────────────────────────────
  "FOXA",   // Fox Corp Class A — S&P 500 news/media

  // ═══════════════════════════════════════════════════════════════════════════
  // ── S&P 400 MID-CAP + HIGH-OPPORTUNITY EXPANSION ──────────────────────────
  // Expands universe from ~373 → ~540 tickers for maximum signal coverage.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Financials — Regional Banks, Wealth, Insurance ───────────────────────
  "WAL",    // Western Alliance Bancorp — Sunbelt commercial bank
  "WBS",    // Webster Financial — mid-cap commercial bank
  "WTFC",   // Wintrust Financial — Chicago-area commercial bank
  "PNFP",   // Pinnacle Financial Partners — Southeast commercial bank
  "UCBI",   // United Community Banks
  "WAFD",   // Washington Federal — Pacific Northwest bank
  "BOKF",   // BOK Financial — Southwest regional bank
  "SFBS",   // ServisFirst Bancshares — correspondent banking
  "EWBC",   // East West Bancorp — US-China cross-border banking
  "IBOC",   // International Bancshares — Texas / Mexico border
  "CATY",   // Cathay General Bancorp — US-China banking
  "HWC",    // Hancock Whitney — Gulf South bank
  "TCBI",   // Texas Capital Bancshares
  "HLI",    // Houlihan Lokey — M&A advisory / investment bank
  "HLNE",   // Hamilton Lane — private markets asset manager
  "SEIC",   // SEI Investments — investment management platforms
  "SF",     // Stifel Financial — wealth management / investment bank
  "VIRT",   // Virtu Financial — market maker / high-frequency trading
  "FAF",    // First American Financial — title insurance
  "LNC",    // Lincoln National — life & annuity insurance
  "KMPR",   // Kemper — specialty personal lines insurance
  "FHI",    // Federated Hermes — active asset management
  "HRB",    // H&R Block — tax preparation services
  "SLM",    // Sallie Mae — consumer / student lending
  "SKT",    // Tanger Factory Outlet Centers — retail REIT
  "NHI",    // National Health Investors — senior housing REIT
  "BRX",    // Brixmor Property Group — open-air retail REIT
  "OFG",    // OFG Bancorp — Puerto Rico / Florida banking
  "FHB",    // First Hawaiian — Pacific regional bank
  "MCY",    // Mercury General — auto insurance
  "WSFS",   // WSFS Financial — Delaware Valley bank
  "CNA",    // CNA Financial — commercial P&C insurance

  // ── Technology & Software ────────────────────────────────────────────────
  "CACI",   // CACI International — defense IT / intelligence
  "SAIC",   // Science Applications International — government IT
  "EPAM",   // EPAM Systems — software engineering services
  "QTWO",   // Q2 Holdings — digital banking software
  "APPF",   // AppFolio — property management software
  "SPSC",   // SPS Commerce — supply chain network
  "BLKB",   // Blackbaud — nonprofit / education software
  "EXLS",   // ExlService Holdings — analytics & BPO
  "EVTC",   // EVERTEC — payment processing (Caribbean/LatAm)
  "COHU",   // Cohu — semiconductor test equipment
  "AEIS",   // Advanced Energy Industries — power conversion
  "ONTO",   // Onto Innovation — process control metrology
  "KLIC",   // Kulicke & Soffa — semiconductor packaging equipment
  "FORM",   // FormFactor — wafer probe cards
  "PLXS",   // Plexus — electronics manufacturing services
  "SANM",   // Sanmina — electronics manufacturing services
  "ACIW",   // ACI Worldwide — real-time payment software
  "CSGS",   // CSG Systems — revenue management / telecom billing
  "IDCC",   // InterDigital — wireless technology licensing
  "GTLB",   // GitLab — DevSecOps platform
  "FROG",   // JFrog — software supply chain / artifact management
  "JAMF",   // Jamf — Apple enterprise device management
  "BOX",    // Box — cloud content management
  "WEX",    // WEX Inc — fleet / corporate payment solutions
  "UI",     // Ubiquiti — enterprise networking equipment
  "CALX",   // Calix — broadband access platforms
  "CLFD",   // Clearfield — fiber optic equipment

  // ── Healthcare — Devices, Diagnostics, Biotech ───────────────────────────
  "DOCS",   // Doximity — physician professional network / telehealth
  "HIMS",   // Hims & Hers — telehealth / consumer health
  "NVCR",   // NovaCure — TTFields electric field cancer therapy
  "GKOS",   // Glaukos — glaucoma / corneal health devices
  "ATRC",   // AtriCure — cardiac surgery ablation devices
  "MMSI",   // Merit Medical Systems — cardiovascular devices
  "RGEN",   // Repligen — bioprocess equipment / chromatography
  "HALO",   // Halozyme — ENHANZE drug delivery platform
  "ASND",   // Ascendis Pharma — endocrinology rare disease
  "ARWR",   // Arrowhead Pharmaceuticals — RNAi therapies
  "ACAD",   // Acadia Pharmaceuticals — CNS / neuropsychiatric
  "GH",     // Guardant Health — liquid biopsy / oncology
  "NTRA",   // Natera — cell-free DNA prenatal / oncology
  "EXAS",   // Exact Sciences — cancer screening (Cologuard)
  "RXRX",   // Recursion Pharmaceuticals — AI drug discovery
  "ACHC",   // Acadia Healthcare — behavioral health facilities
  "AMED",   // Amedisys — home health & hospice
  "CRVL",   // CorVel — workers' comp managed care
  "CERT",   // Certara — biosimulation / drug development software
  "PDCO",   // Patterson Companies — dental / animal health distribution
  "SCI",    // Service Corporation International — funeral services
  "PINC",   // Premier Inc — healthcare performance improvement
  "NEO",    // NeoGenomics — oncology testing services
  "HAE",    // Haemonetics — blood management / processing
  "OMCL",   // Omnicell — pharmacy automation & dispensing

  // ── Industrials, Defense & Specialty ─────────────────────────────────────
  "BWXT",   // BWX Technologies — nuclear components (Navy / DOE)
  "MOOG",   // Moog Inc — precision motion control (defense + aerospace)
  "MSA",    // MSA Safety — safety equipment / gas detection
  "POWL",   // Powell Industries — power distribution switchgear
  "AAON",   // AAON Inc — commercial HVAC systems
  "AGCO",   // AGCO Corporation — agricultural machinery (tractors)
  "ALSN",   // Allison Transmission — automatic transmissions
  "ARCB",   // ArcBest — LTL freight / logistics
  "BECN",   // Beacon Roofing Supply — roofing / waterproofing
  "CLH",    // Clean Harbors — hazardous waste / environmental
  "CMC",    // Commercial Metals — steel / rebar manufacturer
  "CR",     // Crane Company — engineered materials / fluid handling
  "DY",     // Dycom Industries — specialty utility contracting
  "ESAB",   // ESAB Corporation — welding / cutting solutions
  "EXP",    // Eagle Materials — cement / wallboard / aggregates
  "FELE",   // Franklin Electric — water / fuel pumping systems
  "GMS",    // GMS Inc — ceilings & wallboard distribution
  "GRC",    // Gorman-Rupp — pumps for water / wastewater
  "HRI",    // Herc Holdings — equipment rental
  "ITT",    // ITT Inc — motion / flow control components
  "LAD",    // Lithia Motors — auto dealerships (US largest)
  "LSTR",   // Landstar System — asset-light freight brokerage
  "MATX",   // Matson — ocean container shipping (Hawaii / Pacific)
  "MHO",    // M/I Homes — homebuilder (Midwest / Southeast)
  "MLI",    // Mueller Industries — copper products / plumbing
  "SITE",   // SiteOne Landscape Supply — wholesale landscape products
  "TMHC",   // Taylor Morrison Home — homebuilder
  "TREX",   // Trex Company — composite decking / railing
  "TTC",    // Toro Company — outdoor maintenance equipment
  "UFPI",   // UFP Industries — engineered wood / building products
  "WMS",    // Advanced Drainage Systems — water management
  "WOR",    // Worthington Enterprises — steel processing

  // ── Energy (mid-cap E&P / services) ──────────────────────────────────────
  "AR",     // Antero Resources — Appalachian natural gas
  "DINO",   // HF Sinclair — independent petroleum refiner
  "LBRT",   // Liberty Energy — oilfield services / pressure pumping
  "RRC",    // Range Resources — Appalachian natural gas E&P
  "SM",     // SM Energy — Permian Basin E&P
  "SWN",    // Expand Energy (fka Southwestern Energy) — Appalachian gas
  "WHD",    // Cactus Inc — wellhead / pressure control systems

  // ── Consumer Discretionary (mid-cap retail & services) ───────────────────
  "ANF",    // Abercrombie & Fitch — specialty apparel
  "BOOT",   // Boot Barn — Western / work apparel & footwear
  "COLM",   // Columbia Sportswear — outdoor / active apparel
  "DKS",    // Dick's Sporting Goods — sporting goods retail
  "FL",     // Foot Locker — athletic footwear retail
  "HGV",    // Hilton Grand Vacations — timeshare / vacation ownership
  "LOPE",   // Grand Canyon Education — higher education services
  "PLNT",   // Planet Fitness — value fitness clubs
  "SFM",    // Sprouts Farmers Market — specialty / natural grocery
  "SIG",    // Signet Jewelers — jewelry / diamond retail
  "THO",    // Thor Industries — recreational vehicles
  "VFC",    // VF Corporation — outdoor / workwear brands
  "VSCO",   // Victoria's Secret — lingerie / beauty retail
  "YETI",   // YETI Holdings — premium outdoor / drinkware products
  "CELH",   // Celsius Holdings — functional energy drinks
  "CAVA",   // CAVA Group — Mediterranean fast-casual chain
  "WING",   // Wingstop — chicken wings fast-casual franchise

  // ── High-volume Growth & Emerging Themes ─────────────────────────────────
  "SMCI",   // Super Micro Computer — AI server / rack infrastructure
  "MSTR",   // Strategy (MicroStrategy) — Bitcoin treasury / BI software
  "HOOD",   // Robinhood Markets — retail brokerage / crypto
  "RIVN",   // Rivian Automotive — EV delivery vans / trucks
  "LCID",   // Lucid Group — luxury EV sedans
  "RKLB",   // Rocket Lab — small-class orbital launch vehicles
  "IONQ",   // IonQ — trapped-ion quantum computing
  "JOBY",   // Joby Aviation — electric air taxi (eVTOL)
  "ACHR",   // Archer Aviation — electric air taxi
  "AXSM",   // Axsome Therapeutics — CNS rare diseases
  "KRYS",   // Krystal Biotech — gene therapy dermatology
  "BROS",   // Dutch Bros — drive-thru coffee chain
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
  EEM: "international-etf",
  EFA: "international-etf",
};

const BROAD_ETF_SET = new Set<string>([
  "SPY","IVV","VOO","QQQ","DIA","IWM","VTI","VUG","VTV",
  "VXX","UVXY","SVXY",
  "TQQQ","SQQQ","UPRO","SPXU","SSO","SDS","DDM","DXD",
  "XLK","XLF","XLE","XLV","XLP","XLI","XLY","XLU","XLB","XLRE","XLC","VGT",
  "GLD","SLV","GDX","GDXJ","USO","UNG",
  "TLT","TBT","TMF","IEF","SHY","AGG","BND","LQD","HYG","JNK",
  "EEM","EFA",
]);

/**
 * Classify a ticker by asset type.
 * Checks the explicit UNIVERSE_METADATA override first, then falls back to
 * heuristics (broad ETF set → "etf", everything else → "equity").
 */
export function getAssetType(ticker: string): AssetType {
  if (ticker in UNIVERSE_METADATA) return UNIVERSE_METADATA[ticker];
  if (BROAD_ETF_SET.has(ticker)) return "etf";
  return "equity";
}

/**
 * Returns true for leveraged and volatility ETFs whose return distributions
 * are structurally distorted by daily rebalancing / VIX-futures roll decay.
 * These should be excluded from mean-reversion scoring and backtest analysis.
 */
export function isStructurallyDistorted(ticker: string): boolean {
  const t = UNIVERSE_METADATA[ticker];
  return t === "leveraged-etf" || t === "volatility-etf";
}
