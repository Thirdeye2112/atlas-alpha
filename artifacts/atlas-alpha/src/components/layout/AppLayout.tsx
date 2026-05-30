import React from "react";
import { Link, useLocation } from "wouter";
import { 
  useGetMarketOverview, 
  getGetMarketOverviewQueryKey 
} from "@workspace/api-client-react";
import { Activity, LayoutDashboard, Radar, ListTree, FlaskConical, TestTube2 } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

function MarketBar() {
  const { data, isLoading } = useGetMarketOverview({
    query: { queryKey: getGetMarketOverviewQueryKey() }
  });

  if (isLoading || !data) {
    return <div className="h-8 border-b border-border bg-card/50 flex items-center px-4 animate-pulse"><div className="h-4 w-1/3 bg-muted rounded"></div></div>;
  }

  const items = [
    { label: "SPY", quote: data.spy },
    { label: "QQQ", quote: data.qqq },
    { label: "IWM", quote: data.iwm },
    { label: "VIX", quote: data.vix },
  ];

  return (
    <div className="h-8 border-b border-border bg-background flex items-center px-4 text-xs font-mono gap-6 overflow-x-auto whitespace-nowrap">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">REGIME:</span>
        <span className={cn(
          "font-bold",
          data.marketRegime === 'risk_on' ? "text-success" : 
          data.marketRegime === 'risk_off' ? "text-destructive" : "text-warning"
        )}>
          {data.marketRegime.toUpperCase().replace("_", " ")}
        </span>
      </div>
      <div className="w-px h-4 bg-border" />
      {items.map((item) => {
        const isUp = item.quote.change >= 0;
        return (
          <div key={item.label} className="flex items-center gap-2">
            <span className="font-semibold">{item.label}</span>
            <span>{formatCurrency(item.quote.price)}</span>
            <span className={isUp ? "text-success" : "text-destructive"}>
              {isUp ? "+" : ""}{item.quote.changePercent.toFixed(2)}%
            </span>
          </div>
        );
      })}
      <div className="flex-1" />
      {data.pctAboveSma50 != null && (
        <>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>BREADTH</span>
            <span className={cn(
              "font-semibold",
              data.pctAboveSma50 >= 60 ? "text-success" : data.pctAboveSma50 <= 40 ? "text-destructive" : "text-warning"
            )}>SMA50 {data.pctAboveSma50}%</span>
            <span className={cn(
              "font-semibold",
              data.pctAboveSma200 != null && data.pctAboveSma200 >= 60 ? "text-success" :
              data.pctAboveSma200 != null && data.pctAboveSma200 <= 40 ? "text-destructive" : "text-warning"
            )}>{data.pctAboveSma200 != null ? `SMA200 ${data.pctAboveSma200}%` : ""}</span>
          </div>
        </>
      )}
      <div className="w-px h-4 bg-border" />
      <div className="text-muted-foreground">ATLAS ALPHA V0.1.0</div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/scanner", label: "Scanner", icon: Radar },
    { href: "/watchlist", label: "Watchlist", icon: ListTree },
    { href: "/research", label: "Research", icon: FlaskConical },
    { href: "/backtest", label: "Backtest Lab", icon: TestTube2 },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <MarketBar />
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          <span className="font-display text-xl tracking-wider text-primary">ATLAS ALPHA</span>
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 flex overflow-hidden">
        {children}
      </main>
    </div>
  );
}
