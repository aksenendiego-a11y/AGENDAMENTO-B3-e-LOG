# SAD Logística — estado inicial registrado

Registro feito ao iniciar a continuação em 2026-10-29.

- Caminho confirmado: `C:\Users\REV-RESERVA-02\Área de Trabalho\AGENDAMENTO B3 e LOG\sad-logistica`.
- A pasta pai e esta pasta não tinham repositório Git; o projeto B3 da pasta pai não foi alterado. Foi inicializado aqui um repositório independente na branch `main`.
- Não havia `.env` local. `node_modules` e `dist` já estavam ignorados pelo `.gitignore`; não há banco nem segredo de produção no diretório.
- Stack preexistente: Express/TypeScript, PostgreSQL (`pg`), Zod 4, Jest/ts-jest e migrações SQL 001/002.
- Fluxos preexistentes: login com hash scrypt e bearer assinado; empresas/usuários; faixas manuais; reserva transacional sob `FOR UPDATE`; consulta, cancelamento e histórico; cadastro de caminhões e motoristas.
- Testes preexistentes: dois testes de primitivas de segurança e dois testes de integração opcionais com PostgreSQL real (última vaga concorrente e isolamento de empresa).
- Lacunas identificadas: sem frontend, configuração recorrente de calendário, exceções, reagendamento, upload privado, rotas administrativas de consulta/auditoria, lint e E2E.
- O banco isolado usado na continuação anterior é um volume Docker próprio `sad-logistica_sad_logistica_pg`; foi parado sem remover o volume. Nenhum banco preexistente foi identificado ou modificado.

Não foi criado commit inicial: o Git global aponta para uma identidade com endereço pessoal. Evitei gravar esse dado pessoal na autoria do projeto. O estado foi registrado neste arquivo e o repositório permanece pronto para um commit feito com a identidade que o responsável escolher.

## Continuação: calendário mensal e documentos

Em 2026-10-29 foi iniciada a evolução solicitada do portal. O repositório continua sem commits e com as alterações locais anteriores; a pasta B3 continua fora deste repositório e intacta. Antes desta evolução, o banco isolado `sad_logistica` continha dados sintéticos de teste, inclusive uma conta administrativa de teste criada para o portal, e o serviço estava ativo para uso local. Não foi lido nem gravado nenhum dado de produção.

Implementação em andamento nesta etapa:

- A resposta autenticada de disponibilidade agora inclui resumo por dia com slots, capacidade, ocupação, vagas restantes e reservas confirmadas visíveis ao perfil. O cliente pode consultar até 42 datas em uma chamada para preencher a grade mensal e semanas adjacentes.
- O portal recebe navegação mensal, estados do dia e lista de horários/reservas conforme a autorização. O escopo por empresa é aplicado no servidor aos detalhes da reserva.
- O formulário separa seleção XML/PDF, apresenta tamanho e estado, mantém os campos se o envio falhar e reenvia apenas anexos pendentes. A tentativa de criação usa chave de idempotência.
- A migração aditiva `005_calendar_documents_and_idempotency.sql` adiciona nome original saneado, remoção lógica auditável e chave de idempotência; o script `.down.sql` documenta a reversão manual.
- Documentos existentes continuam acessíveis. O sistema já permitia vários documentos por agendamento, então não foi imposta unicidade de XML/PDF; novos envios são aditivos. A remoção mantém metadados/auditoria e revoga o download.

Reversão: reverta o código do portal/API e, se necessário, aplique manualmente `migrations/005_calendar_documents_and_idempotency.down.sql` após backup e verificação. A migração down aborta se algum documento tiver sido marcado como removido, para não deixar uma referência acessível a um arquivo já apagado. Nos demais casos, a reversão descarta os nomes originais e as chaves de idempotência; não remove linhas de reserva nem conteúdo dos documentos ativos.

## Verificação final desta continuação

- Migração `005_calendar_documents_and_idempotency.sql` aplicada no banco local SAD; nenhuma migração destrutiva ou banco de produção foi acessado.
- Backend build/typecheck, frontend build e ESLint passaram.
- Integração PostgreSQL: 16 testes passaram, incluindo escopo por empresa na grade diária, idempotência de reserva, PDF estruturalmente válido/inválido, XML com DTD, remoção privada auditável e reserva numa data gerada pela recorrência.
- Playwright E2E: 1 fluxo passou, cobrindo navegação mensal, reserva com XML e PDF, reagendamento, download e cancelamento.
- `npm audit` do backend e do frontend: zero vulnerabilidades; `git diff --check`: exit code 0.
- Vitest termina com exit code 0 e todos os testes passam, mas em Windows ainda emite o aviso de que duas instâncias Vite demoram mais de 10 segundos para fechar; isso não altera o resultado dos testes.
- API local responde em `http://127.0.0.1:3100/api/v1/health`; portal local responde HTTP 200 em `http://127.0.0.1:5173`. Login da conta administrativa sintética de teste foi validado.
- `.env`, documentos fiscais reais e segredos reais não foram versionados. As credenciais fixas no Compose e no Playwright são exclusivas do banco sintético de desenvolvimento/teste.
