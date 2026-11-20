// Price provider that serves the made-up sample prices.
//
// Every provider has the same shape: { name, getQuotes(tickers) -> { TICKER: { price, ... } } }.
// Step 7 adds a live provider with a Postgres cache. The routes won't change, because they only
// call getQuotes(). Tickers the provider doesn't know are simply left out, and the holdings
// builder warns about them.

import sample from '../sample-data/market-data.json' with { type: 'json' };

export function createSampleMarketData(data = sample) {
  return {
    name: 'sample (made-up prices)',
    async getQuotes(tickers) {
      return Object.fromEntries(tickers.filter((t) => data[t] && t !== '_note').map((t) => [t, data[t]]));
    },
  };
}
