import 'dotenv/config';
import app from './app';
import { pool } from './db';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório');
  if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET deve ter ao menos 32 caracteres');
  await pool.query('SELECT 1');
  const port = Number(process.env.PORT ?? 3100);
  const server = app.listen(port, '127.0.0.1', () => console.log(`SAD logística API em http://127.0.0.1:${port}`));
  const close = () => server.close(() => { void pool.end().finally(() => process.exit(0)); });
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
main().catch(error => { console.error('Falha ao iniciar SAD logística:', error instanceof Error ? error.message : 'erro desconhecido'); process.exitCode = 1; });
