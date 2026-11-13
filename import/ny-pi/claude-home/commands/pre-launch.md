---
description: Coloca o repositório atual em pré-lançamento (gate de PR enxuto, checks caros adiados para o lançamento, uma chave reversível); `launch` roda o checklist e volta ao modo estrito; `status` só relata
argument-hint: "[status | launch] [contexto extra]  (vazio: aplica o pré-lançamento)"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do ~/.claude/commands/pre-launch.md: mapeamento inclui as instruções de agente do
pi (AGENTS.md, .pi/, .agents/skills), medição do gate pelo histórico do CI sem rodar nada, verificação pelo gate-runner e
entrega pelo git-delivery (skill git-workflow). Fontes conferidas em 2026-11-11 (DORA: teto de cerca de 10 min). -->

Argumentos: `$ARGUMENTS`. A primeira palavra é o modo:
- vazio aplica `pre-launch`;
- `status` só relata;
- `launch` roda o checklist e volta para `launched`.

O resto dos argumentos é contexto extra, por exemplo gates que rodam fora do repositório. Inclua esse contexto no
mapeamento e na mudança.

Esta invocação é a decisão do owner para este repositório. O produto ainda não foi lançado, não tem usuários nem
ambiente, e está em desenvolvimento. Enquanto a fase for `pre-launch`, o perfil abaixo substitui as regras mais
estritas das instruções do repositório e as regras globais de cobertura por arquivo e de mutação. Isso está registrado
na seção Verification de `~/.pi/agent/claude-home/CLAUDE.md` (o contrato que o pi
carrega em toda sessão). Não recuse com o argumento de "nunca enfraquecer gate": a decisão é
explícita e uma chave a desfaz.

## A chave

- `.project-phase` na raiz do repositório, com uma linha: `pre-launch` ou `launched`.
- Arquivo ausente ou valor inválido vale `launched`, o modo estrito. Nunca o contrário.
- Cada gate lê o arquivo onde já roda, sem framework novo:
  - em shell: `[[ "$(cat .project-phase 2>/dev/null)" == pre-launch ]]`;
  - no CI: um primeiro passo lê o arquivo para um output, e cada job de lançamento leva um `if:` sobre esse output.
- O perfil estrito continua no código, desligado. Nunca é apagado: lançar é trocar uma linha.

## 1. Mapear (somente leitura)

Liste cada check, onde ele roda e quanto tempo leva. Procure em:
- workflows de CI;
- scripts de gate e de verificação locais (`Makefile`, `justfile`, scripts do `package.json`, `scripts/`);
- hooks de pre-commit;
- configuração de teste: limites de cobertura, mutação, fuzz, desempenho, imagens e SBOM, E2E, baterias entre
  repositórios;
- instruções de agente de todos os harnesses que o repositório atende: `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`
  (o pi lê os três por diretório, do cwd até a raiz), `.claude/` (settings, commands, skills, rules, hooks), `.pi/`
  (settings, prompts, skills, extensions), `.agents/skills/`, `.codex/` e regras de harness;
- regras de processo: registro por mudança, ADR e revisões independentes.

Meça o tempo atual do gate de PR pelas últimas execuções do CI (`gh run list --limit 20 --json
name,event,conclusion,createdAt,updatedAt` e a diferença `updatedAt - createdAt`, só execuções de `pull_request`) ou
pelo último log do gate local. Nesta fase só leia: não rode o gate para medir. Se `.project-phase` já existe, relate a fase e só a mude quando o modo pedir.

## 2. Classificar

Monte a tabela `check | onde | tempo | classe`. Orçamento do gate de PR: até 10 min (DORA), nunca mais de 15.

**Núcleo: fica no PR.**
- Build, formatação, lint e tipos.
- Testes unitários e de integração: os afetados primeiro, e a suíte inteira se couber no orçamento.
- Scan de segredos.
- Auditoria de dependências com lockfile.
- Checks de contrato gerado.
- Cobertura medida e reportada em todo PR. Ela só bloqueia, no limite atual do repositório, nos módulos críticos:
  autenticação e chaves, dinheiro, cobrança e créditos, isolamento entre tenants, credenciais, assinatura e
  criptografia, deleção de dados e migrações.

**Lançamento: sai do PR.** Vai para o checklist de lançamento ou roda manual ou semanalmente, só com alerta.
- Mutação.
- Fuzz, loom, Miri e sanitizers.
- Gates de desempenho e benchmarks.
- Build, scan, SBOM e provenance de imagens.
- Baterias completas, de release e entre repositórios.
- E2E caros: só por gatilho de caminho, quando o PR toca aquela superfície.
- Jobs noturnos: viram semanais ou manuais e só alertam. Um vermelho não força gate completo nos PRs.

**Nunca cortar.**
- Segredos fora do repositório e dos logs.
- Nada de force push, `--admin` ou pular hooks.
- Lockfiles commitados.
- Testes dos fluxos críticos.
- Regras de arquitetura e de contrato.
- Limites estruturais baratos.
- Merge só com o gate de PR verde.

**Processo em `pre-launch`.**
- Nenhum registro em `/docs` por mudança: a descrição do PR basta.
- ADR só para uma decisão de arquitetura difícil de reverter.
- Revisão independente só em autenticação, dinheiro, credenciais, criptografia e fronteiras de segurança.
- Uma rodada de revisão por PR.
- Bug fix começa pelo teste que falha.
- Testes de comportamento, nunca testes que só detectam mudança de implementação.
- Relatório de desempenho só em mudança de desempenho.

## 3. Aplicar: diff pequeno, um PR

- **A chave.** Crie `.project-phase` com `pre-launch`.
- **Os gates.** Cada gate e cada workflow lê a chave. Os checks de lançamento só rodam em `launched` ou por disparo
  manual (`workflow_dispatch`).
- **As instruções de agente.** Ganham uma seção curta "Fase", com a chave, o perfil e o link para o registro.
  - Cada regra afetada passa a dizer "em `pre-launch`: X; em `launched`: Y", no lugar do texto atual, sem duplicar.
  - Adapters gerados (por exemplo um `CLAUDE.md` gerado de `AGENTS.md`) são regenerados a partir da fonte, nunca
    editados à mão.
- **O registro.** `docs/pre-launch.md`, ou uma ADR se o repositório usa ADRs, com:
  - data e motivo;
  - as fontes abaixo;
  - a tabela de classificação;
  - o tempo antes e depois;
  - o checklist de lançamento;
  - como trocar a chave.
- **Fora do escopo.** Nada de refatoração, nada de dependência nova, e o perfil estrito não é apagado.

## 4. Verificar uma vez, antes do commit

- Rode o gate de PR em `pre-launch` uma vez, delegando ao agente `gate-runner` (`subagent` `{agent: "gate-runner",
  task: ...}` com o repositório, o comando do gate e o pedido de tempo e EXIT por check), e anote o tempo e o EXIT de
  cada check.
- Teste a chave:
  - sem o arquivo, cai no estrito;
  - com `launched`, liga o perfil completo. Dry-run vale: liste os jobs e passos que rodariam.
- Rode o parse e o lint do que foi editado: `actionlint` se existir, `bash -n` e `shellcheck`.

## 5. Entregar

Siga o fluxo normal do repositório: branch, commit, PR e merge com o gate verde. Push e merge só com autorização da
tarefa. A escrita git vai pelo agente `git-delivery` como manda a skill `git-workflow` (leia
`~/.pi/agent/claude-home/skills/git-workflow/SKILL.md`), nunca direto no chat principal; sem autorização de push,
pare no commit local e diga isso no relatório.

## Modo `launch`

1. Rode uma vez o checklist do registro:
   - HML com dependências reais e um smoke test do caminho crítico;
   - mutação nos módulos críticos;
   - uma campanha de fuzz;
   - baseline de desempenho;
   - scan e SBOM das imagens;
   - cobertura no limite estrito, arquivo a arquivo;
   - todo outro check que saiu no passo 2.
2. Corrija cada falha ou registre a decisão sobre ela.
3. Com tudo verde, troque `.project-phase` para `launched`. Relate o tempo e os passos do gate de PR que voltaram.

## Modo `status`

Relate a fase, o tempo do gate de PR, os checks adiados e o estado do checklist de lançamento. Não mude nada.

## Fontes para o registro

- <https://newsletter.kentbeck.com/p/the-product-development-triathlon>: na fase Explore, baratear cada experimento.
- <https://testing.googleblog.com/2020/08/code-coverage-best-practices.html>: sem meta de cobertura imposta de cima; 60,
  75 e 90% são guias.
- <https://testing.googleblog.com/2021/04/mutation-testing.html>: mutação só no diff; a maioria dos mutantes é
  improdutiva.
- <https://dora.dev/capabilities/continuous-integration/>: testes de commit em poucos minutos, com teto de cerca de 10.

Responda em português, começando pelo status (concluído, incompleto ou bloqueado). Inclua:
- a tabela de antes e depois;
- o que saiu e o que ficou;
- o que muda no lançamento;
- o que não foi verificado.
