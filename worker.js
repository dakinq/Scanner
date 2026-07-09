// Stock Data Fetch Worker
// Runs in background thread - not paused by Safari when switching apps

const PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.org/?',
];

async function fetchCandles(symbol, days = 365) {
  const end   = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${start}&period2=${end}`;

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const res = await fetch(PROXIES[i] + encodeURIComponent(url), {
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) continue;
      const json   = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;
      const ts = result.timestamp;
      const q  = result.indicators.quote[0];
      const candles = ts
        .map((t, i) => ({
          time:   t,
          open:   q.open[i],
          high:   q.high[i],
          low:    q.low[i],
          close:  q.close[i],
          volume: q.volume[i],
        }))
        .filter(c => c.open && c.high && c.low && c.close);
      if (candles.length > 0) return candles;
    } catch (e) { /* try next */ }
  }
  throw new Error('Alle Proxies fehlgeschlagen');
}

function mergeCandles(existing, fresh) {
  if (!existing?.length) return fresh;
  const lastT  = existing[existing.length - 1].time;
  const cutoff = Math.floor(Date.now() / 1000) - 366 * 86400;
  return [...existing, ...fresh.filter(c => c.time > lastT)].filter(c => c.time > cutoff);
}

function calcMA(cl, p) {
  if (cl.length < p) return null;
  return cl.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function calcRSI(cl, p = 14) {
  if (cl.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = cl.length - p; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    d > 0 ? g += d : l += Math.abs(d);
  }
  if (l === 0) return 100;
  return 100 - (100 / (1 + (g / p) / (l / p)));
}

function computeMetrics(candles) {
  const cl  = candles.map(c => c.close);
  const hi  = candles.map(c => c.high);
  const lo  = candles.map(c => c.low);
  const last = cl[cl.length - 1];
  const prev = cl[cl.length - 2] ?? last;
  const c30  = cl[Math.max(0, cl.length - 31)];
  return {
    close:    last,
    open:     candles[candles.length - 1].open,
    high:     candles[candles.length - 1].high,
    low:      candles[candles.length - 1].low,
    volume:   candles[candles.length - 1].volume,
    change1d: ((last - prev) / prev) * 100,
    change30d:((last - c30)  / c30)  * 100,
    ma20:     calcMA(cl, 20),
    ma50:     calcMA(cl, 50),
    ma200:    calcMA(cl, 200),
    rsi:      calcRSI(cl, 14),
    high52w:  Math.max(...hi),
    low52w:   Math.min(...lo),
  };
}

// Main message handler
self.onmessage = async (e) => {
  const { symbols, existingData } = e.data;
  const BATCH = 2;
  let completed = 0;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const chunk = symbols.slice(i, i + BATCH);

    await Promise.all(chunk.map(async ({ symbol, name, indices }) => {
      try {
        // Calculate how many days are missing
        const existing    = existingData[symbol]?.candles ?? [];
        const lastTs      = existing.length ? existing[existing.length - 1].time : 0;
        const diffDays    = Math.ceil((Date.now() / 1000 - lastTs) / 86400);
        const days        = Math.min(diffDays + 5, 365);

        const fresh   = await fetchCandles(symbol, days);
        const candles = mergeCandles(existing, fresh);
        const metrics = computeMetrics(candles);

        completed++;

        // Send result back to main thread immediately
        self.postMessage({
          type:   'stock',
          symbol, name, indices,
          candles, metrics,
          progress: { completed, total: symbols.length },
        });
      } catch (err) {
        completed++;
        self.postMessage({
          type:   'error',
          symbol,
          progress: { completed, total: symbols.length },
        });
      }
    }));

    // Pause between batches
    await new Promise(r => setTimeout(r, 800));
  }

  self.postMessage({ type: 'done' });
};
