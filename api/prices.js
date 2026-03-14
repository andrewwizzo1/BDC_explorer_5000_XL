// api/prices.js
// Vercel Serverless Function — proxies Yahoo Finance price data
// Deploy: place this file at /api/prices.js in your Vercel project root
//
// Usage: /api/prices?tickers=ARCC,TCPC,OBDC,OTF,TSLX,GBDC,BXSL&months=12
// Returns: { tickers, fetchedAt, weekly: [{d:"3/11/26", ARCC:18.49, ...}, ...] }

export default async function handler(req, res) {
  const {
    tickers = "ARCC,TCPC,OBDC,OTF,TSLX,GBDC,BXSL",
    months = "12",
  } = req.query;

  const tickerList = tickers.split(",").map((t) => t.trim().toUpperCase());
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - parseInt(months) * 30 * 24 * 60 * 60;

  try {
    const results = {};

    await Promise.all(
      tickerList.map(async (ticker) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${now}&interval=1d&includePrePost=false`;
          const response = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
          });

          if (!response.ok) {
            results[ticker] = [];
            return;
          }

          const data = await response.json();
          const chart = data?.chart?.result?.[0];
          if (!chart) {
            results[ticker] = [];
            return;
          }

          const timestamps = chart.timestamp || [];
          const closes = chart.indicators?.quote?.[0]?.close || [];

          results[ticker] = timestamps
            .map((ts, i) => {
              const close = closes[i];
              if (close == null) return null;
              return { ts, close: Math.round(close * 100) / 100 };
            })
            .filter(Boolean);
        } catch (err) {
          results[ticker] = [];
        }
      })
    );

    // Find a ticker with data to use as the date backbone
    const baseTicker =
      tickerList.find((t) => results[t]?.length > 0) || tickerList[0];
    const baseDates = results[baseTicker] || [];

    // Sample to weekly (every 5th trading day)
    const weeklyIdx = baseDates.filter((_, i) => i % 5 === 0);
    if (
      baseDates.length > 0 &&
      weeklyIdx[weeklyIdx.length - 1]?.ts !==
        baseDates[baseDates.length - 1]?.ts
    ) {
      weeklyIdx.push(baseDates[baseDates.length - 1]);
    }

    // For each weekly point, find closest price per ticker
    const weekly = weeklyIdx.map((ref) => {
      const d = new Date(ref.ts * 1000);
      const label = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
      const row = { d: label };

      tickerList.forEach((t) => {
        const arr = results[t];
        if (!arr || arr.length === 0) return;
        let best = arr[0];
        for (const entry of arr) {
          if (Math.abs(entry.ts - ref.ts) < Math.abs(best.ts - ref.ts)) {
            best = entry;
          }
        }
        // Only include if within 5 trading days
        if (Math.abs(best.ts - ref.ts) < 5 * 24 * 3600) {
          row[t] = best.close;
        }
      });

      return row;
    });

    // Cache for 1 hour, serve stale for 2 hours while revalidating
    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=7200"
    );

    res.status(200).json({
      tickers: tickerList,
      months: parseInt(months),
      fetchedAt: new Date().toISOString(),
      dataPoints: weekly.length,
      weekly,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

