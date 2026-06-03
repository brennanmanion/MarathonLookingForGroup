import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createDbAdapter } from './db.js';

const config = loadConfig();

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const db = createDbAdapter(config.databaseUrl);
if (!db) {
  throw new Error('Unable to create database adapter');
}

try {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(currentDir, '..', 'migrations', '0001_init.sql');
  const migrationSql = await readFile(migrationPath, 'utf8');

  await db.query(migrationSql);
  console.log('Applied migrations/0001_init.sql');
} finally {
  await db.close();
}
