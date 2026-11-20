// Production entry point: Vercel runs this file as one serverless function.
//
// How a request is handled on Vercel (see vercel.json):
// - Real files from the website build (public/index.html, /assets/*, favicon.svg) come from the CDN.
// - /api/... is rewritten to this function. Express still sees the original path (/api/health),
//   so the routes in src/app.js match as usual.
// - Any other page URL (/overview, /settings) gets public/index.html, and React picks the page.
//
// Settings come from environment variables set in Vercel. See README > Deployment.

import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createSampleMarketData } from '../src/market/sampleMarketData.js';

const config = loadConfig();
const db = createDb(config);

export default createApp({ db, config, marketData: createSampleMarketData() });
