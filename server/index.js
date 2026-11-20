// Production entry point.
//
// Vercel finds an Express app by looking for a file like index.js that imports "express" and
// default-exports an app, so this file does exactly that and mounts the real app (built in
// src/app.js) inside it. Settings come from environment variables set in Vercel. See README.

import express from 'express';
import { loadConfig } from './src/config.js';
import { createDb } from './src/db/index.js';
import { createApp } from './src/app.js';
import { createSampleMarketData } from './src/market/sampleMarketData.js';

const config = loadConfig();
const db = createDb(config);

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.use(createApp({ db, config, marketData: createSampleMarketData() }));

export default app;
