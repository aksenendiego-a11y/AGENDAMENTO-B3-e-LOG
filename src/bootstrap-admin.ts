import 'dotenv/config';
import { pool } from './db';
import { hashPassword } from './security';

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password || password.length < 16) throw new Error('Defina BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (mínimo 16 caracteres)');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sad-logistica-bootstrap-admin'))");
    const exists = await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
    if (exists.rowCount) throw new Error('Já existe administrador; bootstrap permitido somente na primeira criação');
    const result = await client.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id,email", [email, hashPassword(password)]);
    await client.query('COMMIT');
    console.log(`Administrador inicial criado: ${result.rows[0].email}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Falha no bootstrap'); process.exitCode = 1; });
