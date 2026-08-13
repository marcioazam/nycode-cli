# Research Summary: base para o NyCode CLI

**Data:** 2026-08-13 | **Passes:** 4 | **Confiança:** 92%

Pesquisa RECON (SDD Fase 0) para decidir a base do NyCode CLI, o harness de
coding agent da Nylla. Conduzida com Tavily e Exa como co-primários (Pass 1, 2
e 4) e `sequential-thinking` para cross-validation (Pass 3).

## Key Findings

1. **"OpenClaude" não é um rewrite em Rust — é fork do código-fonte vazado do
   Claude Code.** Em 2026-03-31 a Anthropic publicou por acidente um source map
   `.map` de 59,8 MB dentro do pacote npm `@anthropic-ai/claude-code` v2.1.88,
   expondo ~512 mil linhas de TypeScript em 1.906 arquivos. Os projetos chamados
   "OpenClaude" são forks desse vazamento com um shim multi-provider.
   Fonte: Zscaler, Atlas Peak | Confiança: high | Impacto: critical

2. **Usar o vazamento é bloqueante para produto comercial.** A Anthropic derrubou
   8.000+ cópias via DMCA. Os Termos Comerciais proíbem construir produtos
   concorrentes e reduzir o serviço a forma legível. Refatorar para Rust ou
   Python não sanitiza a obra derivada.
   Fonte: Atlas Peak, Mondaq, Ars Technica | Confiança: high | Impacto: critical

3. **Forks do vazamento carregam risco de supply chain.** Repositórios
   trojanizados com backdoors, exfiltradores e cryptominers já foram observados.
   Fonte: Zscaler | Confiança: high | Impacto: high

4. **"piagent" é o `pi`** — `earendil-works/pi`, antes `badlogic/pi-mono`, criado
   por Mario Zechner e hoje sob a Earendil. MIT, TypeScript, npm
   `@earendil-works/pi-coding-agent` v0.84.1, ~1,65M downloads por semana e 483
   dependentes.
   Fonte: npm, GitHub | Confiança: high | Impacto: critical

5. **O core do pi é deliberadamente pequeno.** Quatro packages (`ai`, `agent`,
   `tui`, `coding-agent`), TUI de ~600 linhas com renderização diferencial,
   4 tools built-in (`read`, `write`, `edit`, `bash`) e system prompt curto. A
   massa do projeto está na superfície multi-provider — geração de catálogo de
   modelos, fluxos OAuth e o instalador npm/git de packages — não no harness.
   Fonte: DeepWiki, ZenML LLMOps database | Confiança: high | Impacto: critical

6. **O pi tem suporte oficial a fork e rebrand** via `piConfig` no `package.json`
   (`name`, `configDir`, `bin`) desde a v0.12.5, afetando banner, paths de config
   e nomes de variável de ambiente sem tocar em código. Precedente comercial em
   produção: `bastani-inc/atomic`, publicado como `@bastani/atomic` com binário
   `atomic` e `configDir` `.atomic`.
   Fonte: pi development.md, bastani-inc/atomic | Confiança: high | Impacto: high

7. **O pi aponta para o gateway sem código de integração**, via override de
   `baseUrl` de provider built-in no `~/.pi/agent/models.json`, com `api` em
   `anthropic-messages` ou `openai-completions`.
   Fonte: pi models.md, PR #406 | Confiança: high | Impacto: critical

8. **Velocidade de release do pi é alta e quebra APIs.** v0.12.5 há 8 meses,
   v0.84.1 hoje. A v0.84.0 sozinha trocou o modelo de sessão pelo v4 lane-based,
   mudou `ModelRegistry.refresh()`, renomeou `ModelsStreamTransforms` e removeu
   as APIs JSONL legadas. Mantenedores de fork relatam "recurring reconciliation
   burden each release".
   Fonte: release notes v0.84.0, discussão #297 | Confiança: high | Impacto: high

9. **Grok Build é Apache 2.0, não MIT.** `xai-org/grok-build`, publicado em
   2026-07-15, Rust, ~24,8k stars. Cobre os três dialetos do gateway via
   `api_backend` (`chat_completions`, `responses`, `messages`) e descobre o
   catálogo automaticamente por `[endpoints] models_base_url`. Porém a xAI **não
   aceita pull requests externos** e sincroniza o repositório de um monorepo
   interno.
   Fonte: xai-org/grok-build, docs.x.ai, Appwrite | Confiança: high | Impacto: high

10. **Embutir V8 destrói o ganho de binário.** Medição do PR do nanocodex em
    Apple arm64: controle Node 17.209.648 bytes; QuickJS embutido 18.526.432
    bytes (+1,26 MiB, +7,65%); protótipo V8 embutido 68.314.656 bytes (+51 MB).
    O ADR-001 do `loadr` chegou à mesma conclusão de forma independente e aceitou
    a ausência de JIT porque a carga é I/O bound — um harness de agente é ainda
    mais I/O bound que um load tester.
    Fonte: nanocodex PR #8, loadr ARCHITECTURE.md | Confiança: high | Impacto: critical

11. **Baseline real de startup do pi é ~0,94s, não os 2s do espantalho.** Medição
    do próprio repositório em M1 Max com Node 22: cold start em modo RPC de
    ~1,30s, caindo para ~0,94s com entrypoint bundled. O binário compilado por
    `bun --compile` tem ~67 MB e **não é self-contained** — lê `package.json` e
    `theme/*` do diretório do executável, forçando embarcar ~260 MB.
    Fonte: pi issue #2522, issue #5108 | Confiança: high | Impacto: high

12. **OAuth de assinatura em cliente terceiro está bloqueado.** Desde fevereiro de
    2026 os Consumer Terms da Anthropic restringem OAuth de contas Free/Pro/Max
    ao Claude Code e ao claude.ai, incluindo explicitamente o Agent SDK. Há
    enforcement server-side desde janeiro de 2026, respondendo `"This credential
    is only authorized for use with Claude Code and cannot be used for other API
    requests."` O OpenCode removeu o suporte nativo no PR #18186 em 2026-03-19.
    Goose, Cline e Roo Code tiveram tokens bloqueados. O criador do OpenClaw foi
    banido em 2026-04-04. O client ID do Claude Code é hardcoded e a Anthropic não
    registra client IDs de terceiros.
    Fonte: autonomee.ai, moltis docs, yage.ai, GitHub NousResearch#48320
    | Confiança: high | Impacto: critical

13. **`rmcp` é o SDK MCP oficial em Rust.** Apache-2.0, runtime tokio, features de
    cliente e servidor, Streamable HTTP, transporte por child-process e OAuth.
    Targeta as revisões de spec 2025-11-25 e 2026-07-28.
    Fonte: modelcontextprotocol/rust-sdk | Confiança: high | Impacto: high

14. **`models.dev` resolve o catálogo multi-provider.** Base open-source de
    especificações, preços e capacidades de modelos, consumida via
    `curl https://models.dev/api.json`. É o que o OpenCode usa para suportar 75+
    providers.
    Fonte: anomalyco/models.dev, OpenCode docs | Confiança: high | Impacto: high

15. **O crate `keyring` é o equivalente nativo do `@napi-rs/keyring`** que o
    `nylla-npm` já usa — Secret Service no Linux, Keychain no macOS, Credential
    Manager no Windows. Gotcha documentado: o backend `async-secret-service`
    deadlocka se chamado na thread principal do runtime async; isolar em thread
    própria.
    Fonte: docs.rs/keyring | Confiança: high | Impacto: medium

16. **Contexto local.** O `nylla-gateway` (Go) serve Anthropic Messages, OpenAI
    Chat Completions, OpenAI Responses e Google GenAI, com catálogo canônico em
    `GET /v1/models` anunciando a janela de contexto real por ADR-0091/0092. O
    `nylla-npm` já é um CLI TypeScript publicado como `nylla-adapter` (MIT, bin
    `nylla`) que aponta ferramentas de IA para o gateway, com `src/gateway/`,
    `src/environment/` e `@napi-rs/keyring`.
    Fonte: repositórios locais | Confiança: high | Impacto: critical

## Open Questions

- Contagem exata de stars do `pi` diverge entre fontes (46k a 87k). Impacto: baixo
  — 1,65M downloads semanais já estabelece a adoção.
- Se o `api_backend = "responses"` do Grok Build usa `previous_response_id`,
  `background:true` ou `conversation`, ele quebra contra o gateway, que recusa os
  três. Impacto: médio, e só relevante se o Grok Build virar alvo de writer.
- Qualidade percebida de uma TUI diferencial em Rust frente à do pi só é
  respondível com esqueleto rodando. Impacto: alto — é o kill-gate da Wave 0.

## Sources

- https://www.zscaler.com/blogs/security-research/anthropic-claude-code-leak — timeline do vazamento e risco de supply chain
- https://www.atlaspeakresearch.com/report/8ee674 — análise jurídica do vazamento
- https://arstechnica.com/ai/2026/04/anthropic-says-its-leak-focused-dmca-effort-unintentionally-hit-legit-github-forks/ — DMCA da Anthropic
- https://rfc.earendil.com/0015/ — política de licenciamento do pi
- https://mariozechner.at/posts/2026-04-08-ive-sold-out/ — MIT perpétuo e trademark
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md — provider customizado
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/development.md — `piConfig` e rebrand
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md — SDK embutível
- https://deepwiki.com/earendil-works/pi/1.2-monorepo-structure-and-build-system — estrutura do monorepo
- https://www.zenml.io/llmops-database/building-pi-a-minimal-extensible-coding-agent-framework — TUI de 600 linhas, 4 tools
- https://github.com/earendil-works/pi/issues/2522 — baseline de startup
- https://github.com/earendil-works/pi/issues/5108 — binário compilado não self-contained
- https://github.com/bastani-inc/atomic — precedente de fork rebrandado
- https://github.com/xai-org/grok-build — harness Rust Apache-2.0 da xAI
- https://docs.x.ai/build/settings — `config.toml` e `api_backend`
- https://github.com/gakonst/nanocodex/pull/8 — medição QuickJS vs V8
- https://github.com/levantar-ai/loadr/blob/main/ARCHITECTURE.md — ADR-001, rquickjs sobre deno_core
- https://github.com/modelcontextprotocol/rust-sdk — SDK MCP oficial
- https://github.com/anomalyco/models.dev — catálogo de modelos
- https://docs.rs/keyring — armazenamento de credenciais
- https://autonomee.ai/blog/claude-code-terms-of-service-explained — restrição de OAuth
- https://docs.moltis.org/anthropic-oauth.html — enforcement server-side e client ID hardcoded
- https://yage.ai/share/claude-code-subscription-not-a-developer-credential-en-20260321.html — PR de compliance do OpenCode

## Recommended Approach

Construir o NyCode CLI em Rust espelhando a arquitetura de quatro camadas do `pi`
(`ai`, `agent`, `tui`, `cli`), sem runtime JavaScript embutido — extensões via MCP,
hooks e `SKILL.md` — com o `nylla-gateway` como caminho primário e o catálogo
multi-provider vindo do `models.dev`. Toda a superfície de OAuth de assinatura
fica isolada atrás de feature flag desligada por padrão, por ser o único
componente com risco jurídico ativo.

## Nota de decisão

A alternativa de menor custo, registrada aqui para posteridade, era consumir o
`pi` como dependência via `createAgentSession()` e embarcar o provider do gateway
programaticamente — dias de trabalho em vez de meses, preservando o ecossistema de
extensões TypeScript. O ganho da reescrita em Rust é medido e real (startup de
~0,94s para dezenas de ms, memória ~5x menor, binário estático de verdade), e a
decisão de pagar esse custo em troca de propriedade total do harness foi tomada de
forma informada.
