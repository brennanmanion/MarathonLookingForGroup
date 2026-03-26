import { loadConfig } from './config.js';
import { createDbAdapter } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = createDbAdapter(config.databaseUrl);
const app = await createApp(config, db);

try {
  await app.listen({
    host: config.host,
    port: config.port
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
} finally {
  if (process.exitCode && db) {
    await db.close();
  }
}

