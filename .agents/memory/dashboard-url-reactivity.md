---
name: Dashboard URL reactivity
description: How to make Dashboard ticker state react to wouter navigation (watchlist clicks, scanner links)
---

## Rule
Read the ticker URL param via wouter's `useSearch()` hook (not `window.location.search`), derive it with `useMemo`, and sync it into local state with `useEffect`. This ensures clicking a watchlist item or any Link that sets `?ticker=X` updates the chart and score gauge.

**Why:** `useState(new URLSearchParams(window.location.search).get("ticker"))` reads the URL once at mount. Subsequent wouter navigation changes the URL but React doesn't re-run `useState` initializers, so the chart stays stuck on the original ticker.

**How to apply:**
```typescript
const search = useSearch();  // from "wouter"
const urlTicker = useMemo(() => new URLSearchParams(search).get("ticker") || "AAPL", [search]);
const [ticker, setTicker] = useState(urlTicker);
useEffect(() => { setTicker(urlTicker); setSearchInput(urlTicker); }, [urlTicker]);
```
