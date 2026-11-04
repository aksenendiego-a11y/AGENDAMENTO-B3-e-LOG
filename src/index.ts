import 'dotenv/config';
import app, { closeDocumentStorage } from './app';
import { pool } from './db';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashPassword } from './security';

async function runMigrations() {
  console.log('--- INICIANDO MIGRAÇÕES ---');
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');

    let directory = path.join(process.cwd(), 'migrations');
    try {
      await fs.access(directory);
      console.log(`Pasta de migrations encontrada em: ${directory}`);
    } catch {
      directory = path.join(__dirname, '..', 'migrations');
      console.log(`Tentando pasta alternativa: ${directory}`);
    }

    const files = await fs.readdir(directory);
    console.log(`Arquivos na pasta: ${files.join(', ')}`);

    const names = files.filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
    console.log(`${names.length} migrações encontradas para processar.`);

    for (const name of names) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name]);
      if (exists.rowCount) {
        console.log(`Migração ${name} já aplicada.`);
        continue;
      }

      console.log(`Aplicando migração: ${name}...`);
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
        await client.query('COMMIT');
        console.log(`✅ Migração ${name} aplicada com sucesso.`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`❌ Erro ao aplicar migração ${name}:`, error);
        throw error;
      }
    }
    console.log('--- MIGRAÇÕES CONCLUÍDAS ---');
  } catch (err) {
    console.error('❌ FALHA NO PROCESSO DE MIGRAÇÃO:', err);
    throw err;
  } finally {
    client.release();
  }
}

async function bootstrapAdmin() {
  console.log('--- VERIFICANDO USUÁRIO ADMIN ---');
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin.teste.local@example.test';
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'AdminSeguro123!@#';
  const client = await pool.connect();
  try {
    const exists = await client.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1");
    if (!exists.rowCount) {
      console.log(`Criando administrador inicial: ${email}`);
      await client.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin')", [email, hashPassword(password)]);
      console.log('✅ Administrador criado com sucesso.');
    } else {
      console.log('Usuário administrador já existe.');
    }
  } catch (error) {
    console.error('❌ Erro no bootstrap do admin:', error);
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🚀 Iniciando inicialização do sistema...');

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório');
  if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET deve ter ao menos 32 caracteres');

  try {
    // 1. Testa a conexão básica
    await pool.query('SELECT 1');
    console.log('📡 Conexão com banco de dados OK.');

    // 2. Roda as migrações ANTES de subir o servidor
    await runMigrations();

    // 3. Garante o admin
    await bootstrapAdmin();

    // 4. Inicia o servidor Express
    const port = Number(process.env.PORT ?? 3100);
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`✅ SAD logística API está ONLINE na porta ${port}`);
    });

    const close = () => server.close(() => {
      closeDocumentStorage();
      void pool.end().finally(() => {
        console.log('Servidor encerrado.');
        process.exit(0);
      });
    });

    process.on('SIGINT', close);
    process.on('SIGTERM', close);
  } catch (error) {
    console.error('💥 ERRO CRÍTICO NA INICIALIZAÇÃO:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Falha fatal:', error);
  process.exit(1);
});
