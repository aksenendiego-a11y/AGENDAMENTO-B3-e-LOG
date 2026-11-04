import 'dotenv/config';
import { pool } from './db';
import { hashPassword } from './security';

async function main() {
  const email = 'aksenentransportes@teste.com.br';
  const password = 'shevchenko220291';
  const companyName = 'Aksen Transportes';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Cria ou recupera a empresa
    const companyRes = await client.query(
      `INSERT INTO companies(name, active) VALUES($1, true)
       ON CONFLICT (name) DO UPDATE SET active = true RETURNING id`,
      [companyName]
    );
    const companyId = companyRes.rows[0].id;

    // Cria ou atualiza o usuário
    const hashed = hashPassword(password);
    await client.query(
      `INSERT INTO users(email, password_hash, role, company_id, active)
       VALUES($1, $2, 'company', $3, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [email, hashed, companyId]
    );

    await client.query('COMMIT');
    console.log(`Usuário ${email} criado/atualizado com sucesso para a empresa ${companyName}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Falha ao criar usuário:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();