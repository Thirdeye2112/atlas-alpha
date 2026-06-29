import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Scanner from "@/pages/Scanner";
import Watchlist from "@/pages/Watchlist";
import Research from "@/pages/Research";
import BacktestLab from "@/pages/BacktestLab";
import BotLab from "@/pages/BotLab";
import CommandRef from "@/pages/CommandRef";
import TranscriptLab from "@/pages/TranscriptLab";
import AppLayout from "@/components/layout/AppLayout";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function App() {
  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppLayout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/scanner" component={Scanner} />
              <Route path="/watchlist" component={Watchlist} />
              <Route path="/research" component={Research} />
              <Route path="/backtest" component={BacktestLab} />
              <Route path="/bot" component={BotLab} />
              <Route path="/commands" component={CommandRef} />
              <Route path="/transcripts" component={TranscriptLab} />
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
