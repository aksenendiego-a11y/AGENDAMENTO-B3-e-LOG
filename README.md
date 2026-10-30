# SAD Logística

Aplicação isolada de agendamento de descarga, com API Express/TypeScript, PostgreSQL e portal React/Vite. O sistema financeiro B3 está no diretório pai e não faz parte deste repositório.

## Requisitos

- Node.js 24 LTS (ou versão compatível com as dependências atuais) e npm.
- Docker Desktop para PostgreSQL local de teste/desenvolvimento, ou PostgreSQL 16 compatível.
- PowerShell no Windows; use `npm.cmd` para não depender da política de execução de scripts.

## Instalação e configuração local

Na raiz do repositório SAD:

```powershell
Copy-Item .env.example .env
npm.cmd ci
Set-Location .\web
npm.cmd ci
Set-Location ..
```

Edite `.env` localmente. Defina `TOKEN_SECRET` com pelo menos 32 bytes aleatórios, além de `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` (mínimo de 16 caracteres). Nunca coloque esses valores em Git. `DATA_DIR` aponta para armazenamento privado de documentos e `MAX_DOCUMENT_BYTES` define o tamanho máximo (padrão: 10 MiB).

O Compose fornece um PostgreSQL **local sintético** chamado `sad_logistica`, publicado em `127.0.0.1:5433`. As credenciais do Compose são apenas para desenvolvimento/testes, não para produção:

```powershell
docker compose up -d --wait postgres
npm.cmd run migrate
npm.cmd run bootstrap-admin
```

O bootstrap cria o administrador informado no `.env` e não imprime a senha. Inicie API e frontend em terminais separados:

```powershell
# terminal 1, raiz sad-logistica
npm.cmd run dev

# terminal 2, raiz sad-logistica
Set-Location .\web
npm.cmd run dev
```

API: `http://127.0.0.1:3100/api/v1`; portal: `http://127.0.0.1:5173`. A Vite encaminha chamadas `/api` para a API local. Para encerrar, use Ctrl+C nos terminais. Para parar o PostgreSQL e preservar os dados, execute `docker compose stop postgres`. Não use `docker compose down -v` se quiser manter o volume.

## Uso e regras da agenda

Entre como administrador e configure uma agenda recorrente antes de aceitar reservas. A configuração exige fuso IANA, data de vigência, dias da semana, faixas, duração em minutos e capacidade. Não há horários, capacidade ou limites de peso presumidos pelo sistema. Exceções podem bloquear uma data ou substituir as faixas daquele dia. Uma configuração nova deve ter vigência posterior à atual e não pode substituir horários com reservas futuras confirmadas; faixas antigas e seu histórico permanecem preservados.

Usuários de empresa gerenciam caminhões e motoristas, consultam disponibilidade, reservam com peso/unidade e nota fiscal, consultam protocolo/histórico, enviam XML/PDF, cancelam e reagendam. As reservas concorrentes são serializadas com locks no PostgreSQL e a capacidade é verificada dentro da transação. Sessões são bearer tokens assinados; cada requisição autenticada também verifica se a conta continua ativa.

Documentos ficam fora da pasta pública, com nome interno aleatório e download autenticado/autorizado. A validação XML rejeita DTD e entidades; PDF/XML são verificados quanto ao conteúdo e formato. O armazenamento padrão é local, sem criptografia/replicação/retention gerenciada: para produção, substituir por armazenamento privado durável e definir política de backup, retenção e recuperação. O limite de tentativas de login é em memória e precisa de armazenamento compartilhado em implantação multi-instância.

## Calendário mensal e documentos

Na área de agendamentos, a visualização mensal busca slots e um resumo diário em uma única chamada `GET /api/v1/availability?from=AAAA-MM-DD&to=AAAA-MM-DD`. A chamada aceita até 42 dias para incluir as semanas adjacentes da grade. Cada dia diferencia agenda ausente, dia sem atendimento, exceção fechada, disponibilidade, ocupação parcial e lotação; lista capacidade total, ocupação e vagas restantes. Os horários usam o fuso retornado pela agenda. Reservas exibidas são sempre limitadas à sessão: o administrador vê a operação; a empresa vê somente as próprias reservas. A vaga exibida é uma fotografia da disponibilidade; a reserva continua validada sob lock transacional no PostgreSQL.

No cadastro, XML e PDF têm campos separados. Cada arquivo pode ter até `MAX_DOCUMENT_BYTES` bytes (padrão `10485760`, 10 MiB). O servidor confere o tipo selecionado contra a extensão, rejeita DTD/entidades no XML e verifica cabeçalho, referência de xref e fim do arquivo PDF. O MIME fornecido pelo navegador não é usado como validação de conteúdo. Downloads passam por autorização autenticada; XML é baixado como arquivo, PDF pode ser aberto em uma visualização temporária autenticada. O cadastro atual aceita vários documentos por agendamento; cada envio adiciona um documento. Remover um documento o marca como indisponível, registra auditoria e tenta apagar o arquivo privado, mantendo a linha de metadados para preservar a trilha.

Se um anexo falhar após a reserva ser criada, a tela mantém os campos preenchidos e oferece reenvio somente dos arquivos pendentes. A criação da reserva usa o cabeçalho `Idempotency-Key`, evitando reservas duplicadas quando a mesma tentativa é reenviada. Uma falha em um dos documentos não desfaz a reserva nem os uploads já concluídos.

## Comandos de validação e build

```powershell
# raiz sad-logistica
npm.cmd run build
npm.cmd run lint
npm.cmd test

# Integração PostgreSQL real (requer Compose iniciado e .env configurado)
$env:RUN_POSTGRES_INTEGRATION = '1'
npm.cmd test
Remove-Item Env:RUN_POSTGRES_INTEGRATION

# E2E Playwright, usando Chromium instalado pelo Playwright
npm.cmd run test:e2e

# Build do portal
Set-Location .\web
npm.cmd run build
Set-Location ..

# Dependências e segredos
npm.cmd audit
npm.cmd audit --omit=dev
git diff --check
```

O teste de integração usa somente o banco local configurado em `DATABASE_URL`; faça-o apontar para um banco descartável/isolado antes de executar. Os testes criam dados sintéticos e limpam os registros criados. A aplicação serve `web/dist` em produção quando o diretório está presente; a execução de produção deve fornecer variáveis seguras e infraestrutura adequada.

## API

O contrato OpenAPI está em [`openapi.yaml`](./openapi.yaml). Todas as rotas privadas requerem `Authorization: Bearer <accessToken>`. Health check: `GET /api/v1/health`.

## Dados e migrações

`npm.cmd run migrate` aplica, em ordem, as migrações SQL versionadas e pode ser repetido. A migração `005_calendar_documents_and_idempotency.sql` adiciona nome original saneado, remoção lógica/auditável e chave de idempotência sem reescrever reservas ou excluir documentos existentes. Uma reversão manual pode usar `migrations/005_calendar_documents_and_idempotency.down.sql` após reverter o código e fazer backup. O script aborta se houver documento marcado como removido, pois remover esse estado poderia expor referência sem arquivo. Caso contrário, a reversão descarta nomes originais e chaves de idempotência. Para backup local, use `pg_dump` com credenciais fornecidas por ambiente seguro; teste a restauração em banco isolado. Não há backup automatizado, política de retenção ou implantação de produção incluídos neste projeto.
