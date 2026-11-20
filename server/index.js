// Production entry point (Vercel imports the default export).
// Settings come from environment variables set in the Vercel dashboard. See .env.example.

import { loadConfig } from './src/config.js';
import { createDb } from './src/db/index.js';
import { createApp } from './src/app.js';
import { createSampleMarketData } from './src/market/sampleMarketData.js';

const config = loadConfig();
const db = createDb(config);

export default createApp({ db, config, marketData: createSampleMarketData() });
