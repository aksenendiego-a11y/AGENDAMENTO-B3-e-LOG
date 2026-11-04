# Deploy fácil e gratuito — Render

## 1. Preparar o código

1. Abra o projeto no GitHub:
   * Crie um repositório `sad-logistica` no GitHub
   * Faça push do projeto atual para o repositório
2. Confirme os scripts no `package.json`:
   * `npm run build` → `tsc -p tsconfig.json`
   * `npm start` → `node dist/index.js`
3. O frontend da pasta `web` é servido como estático pelo Express (`src/app.ts` verifica `web/dist`).

## 2. Banco Postgres gratuito

Opção mais simples: use Supabase ou o Postgres do Render.

**Render Postgres gratuito:**
* Acesse `dashboard.render.com` → New → PostgreSQL
* Nome: `sad-logistica-db`
* Anote a `DATABASE_URL` gerada.

**Supabase gratuito:**
* Crie projeto no supabase.com → Project Settings → Database → Connection string (URI)
* Use essa URI como `DATABASE_URL`.

## 3. Variáveis de ambiente necessárias

No serviço Node do Render configure:

```
NODE_ENV=production
PORT=10000
DATABASE_URL=<cole a URI do Postgres>
TOKEN_SECRET=<gere uma chave de 32+ caracteres, por exemplo com: openssl rand -hex 32>
TOKEN_TTL_SECONDS=28800
MAX_DOCUMENT_BYTES=10485760
STORAGE_DRIVER=local
DATA_DIR=./private_data
BOOTSTRAP_ADMIN_EMAIL=admin@seuapp.com
BOOTSTRAP_ADMIN_PASSWORD=<senha forte de 16+ caracteres>
```

> O projeto aceita `STORAGE_DRIVER=local` em produção. Armazenamento em disco é aceitável para a camada gratuita.

## 4. Configurar o serviço Web no Render

* New → Web Service → Conecte o repositório GitHub
* Build Command: `npm install && npm run build`
* Start Command: `node dist/index.js`
* Environment: Node 20 ou superior
* Anexe o banco Postgres criado no passo 2

Após deploy, execute uma vez a migração e o bootstrap do admin:

No Render → Shell:

```
npm run migrate
npm run bootstrap-admin
```

Ou execute de forma automática adicionando um script `prestart` no `package.json`:

```json
"prestart": "ts-node src/migrate.ts && ts-node src/bootstrap-admin.ts"
```

## 5. Testar

A URL pública do Render será algo como `https://sad-logistica.onrender.com`.
Acesse `/api/v1/health` para validar.

## 6. Observações

* O frontend React é servido pelo próprio Express, então não precisa de Vercel/GitHub Pages.
* A porta 3100 usada no localhost é sobreposta pela variável `PORT` do Render.
* Para ambiente de desenvolvimento local, continue usando `npm run dev` na porta 3100.
* Se quiser escalar para armazenamento S3/R2 depois, basta trocar `STORAGE_DRIVER` para `r2` e preencher as variáveis `R2_*`.
