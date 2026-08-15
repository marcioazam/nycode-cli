# Glossário — NyCode CLI

Linguagem ubíqua: estas palavras aparecem no código, nos ADRs e nas specs com
o mesmo significado. Um termo usado com sentido diferente do daqui é defeito
de um dos dois lados — do código ou deste glossário — nunca uma diferença
tolerada.

| Termo | Significado |
|---|---|
| **Dialeto** | Formato de wire de um provedor: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses |
| **Turno** | Uma resposta do modelo, montada a partir dos eventos de stream |
| **Rodada** | Um ciclo pedido-ferramenta-resultado dentro de um `run` |
| **Gate** (de permissão) | A política que autoriza ou nega uma chamada de ferramenta |
| **Paridade** | Igualdade de contrato observável entre `nycode` e o harness de referência — mesma sequência de tool calls, mesmo estado final de arquivos, mesma contabilidade de tokens, mesmo `stop_reason`, mesmo envelope de erro |
| **Exemption** | Dispensa declarada de um piso de cobertura, sempre com ratchet — nunca `below-floor` sem teste que falha primeiro |
| **Sessão montada** | O estado que os pisos de startup e memória medem: credencial resolvida, workspace varrido, árvore de sessão indexada, extensões no ar — não a chegada do processo (`--version`), que o `clap` resolve antes de qualquer uma dessas coisas |
| **Confinamento** | Restrição do comando de shell aplicada pelo sistema operacional (bubblewrap no Linux, Seatbelt no macOS) — não apenas pela política do harness. Ausência é avisada ao usuário, nunca assumida silenciosamente |
| **Catálogo** | O conjunto de modelos que o gateway configurado serve, descoberto no arranque e cacheado — nunca hardcoded |
| **Extensão** | Um dos três mecanismos que ampliam o agente sem recompilar: servidor MCP, skill ou hook |
| **Onda** (wave) | Uma fatia do roadmap com critério de aceite próprio — ver [`docs/product/ROADMAP.md`](product/ROADMAP.md) |
| **Harness de referência** | A implementação usada como padrão de comparação para paridade e para o piso relativo de performance — hoje o `pi`, com o `codex-cli` como concorrente nomeado para performance |
| **ADR** | Registro de uma decisão de arquitetura significativa — a alternativa descartada e o que a faria ser revista, não um relatório do que foi feito |
| **Ratchet** | Um valor que só pode melhorar, nunca piorar — uma entrada obsoleta (arquivo que sumiu, condição que deixou de valer) reprova o gate em vez de ficar inerte |
| **Baseline** | Um valor medido, versionado com a origem da medição (versão, data, digest do artefato) — nunca editado à mão para passar num gate; quem o atualiza é o processo que remede |
| **Achado** | Um item específico de uma auditoria de segurança ou de conformidade, citado por identificador nos ADRs e checklists (ex.: achado A2, achado C3) |
| **Padrão externo** | O `base-software-rules` (SOTA-2026), adotado no nível L2 — ver [ADR-0032](architecture/decisions/0032-adota-padrao-externo-sota-2026-nivel-l2.md) e a seção correspondente do [`AGENTS.md`](../AGENTS.md) |
