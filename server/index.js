// Production entry point.
//
// Vercel finds an Express app by looking for a file like index.js that imports "express" and
// default-exports an app, so this file does exactly that and mounts the real app (built in
// src/app.js) inside it. Settings come from environment variables set in Vercel. See README.
//
// The website itself (built by `npm run build` into public/) is served by Vercel's CDN. Page URLs
// like /overview have no file of their own, so they reach this app and get index.html back.

import { readFileSync } from 'node:fs';
import express from 'express';
import { loadConfig } from './src/config.js';
import { createDb } from './src/db/index.js';
import { createApp } from './src/app.js';
import { spaShell } from './src/http/spaShell.js';
import { createSampleMarketData } from './src/market/sampleMarketData.js';

const config = loadConfig();
const db = createDb(config);

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

// The path is written out in full inside readFileSync so Vercel's file tracing sees it and puts
// public/index.html into the function bundle.
let indexHtml = null;
try {
  indexHtml = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
} catch {
  console.warn('public/index.html not found. Run `npm run build` to serve the website from this app.');
}
if (indexHtml) app.use(spaShell(indexHtml));

app.use(createApp({ db, config, marketData: createSampleMarketData() }));

export default app;
