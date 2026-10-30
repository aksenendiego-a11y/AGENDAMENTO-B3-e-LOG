import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.join(__dirname, '..', 'migrations');
    const names = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    for (const name of names) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (exists.rowCount) { console.log(`${name} já aplicada`); continue; }
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log(`${name} aplicada`);
    }
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error('Falha na migração:', error instanceof Error ? error.message : 'erro desconhecido'); process.exitCode = 1; });
