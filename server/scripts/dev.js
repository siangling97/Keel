// Local development server: npm run dev
//
// No database setup needed. Without DATABASE_URL it uses PGlite (real Postgres in WebAssembly)
// and keeps the data in server/.pglite. With DATABASE_URL in .env, it uses that Postgres instead.

import { loadConfig, loadEnvFile } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { createSampleMarketData } from '../src/market/sampleMarketData.js';

loadEnvFile();
const config = loadConfig();
const db = createDb(config);

const ran = await runMigrations(db);
if (ran.length > 0) console.log(`Applied migrations: ${ran.join(', ')}`);

const app = createApp({ db, config, marketData: createSampleMarketData() });
app.listen(config.port, () => {
  const where = config.databaseUrl ? 'DATABASE_URL' : `PGlite in ${config.pgliteDataDir}`;
  console.log(`API running at http://localhost:${config.port}/api (database: ${where})`);
});
