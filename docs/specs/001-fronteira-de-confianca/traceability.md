# traceability — fronteira de confiança do agente

Cada achado da auditoria alcança um requisito da [`spec.md`](spec.md), uma onda
do [`plan.md`](plan.md) e um teste que o protege. Uma linha sem teste é um
requisito que ninguém vai perceber quando regredir.

Os nomes de teste estão em inglês e descrevem o comportamento protegido, como o
[`AGENTS.md`](../../../AGENTS.md) exige.

## Estado — 2026-08-13 (segunda rodada)

Fechados: todos os quatro críticos, quatro dos cinco altos, cinco dos sete
médios, os quatro de privacidade e os cinco de severidade baixa. As tabelas
abaixo trazem o nome do teste que de fato existe; onde ele difere do planejado,
o que vale é este.

A segunda rodada fechou B1 a B5, resolveu o **relato** de M1 e encerrou M7 com
um veredito em vez de uma pendência. Resta um único item aberto.

| Aberto | Por quê |
|---|---|
| A4 filtro de hook por ferramenta | A ADR-0009 prevê filtrar "na configuração", que não existe para hooks. É feature, não correção — e o consentimento do ADR-0016 removeu o pior do risco, já que o hook não roda sem o usuário ter aprovado aquele executável. |

Dois itens fecharam com o resultado registrado em vez do resultado planejado, e
a diferença é deliberada:

- **M1** era "trocar `(allow default)` por negar por omissão". Isso segue exigindo
  um Mac. O que o **FR-8 de fato pede** é que uma política que permite por
  omissão não seja relatada como equivalente a uma que nega — e *isso* foi feito
  e é verificável aqui: `Confinement::strength()` distingue três posturas, o
  aviso diz "PARCIAL" e a resposta ao modelo carrega o marcador. O endurecimento
  do SBPL virou trabalho nomeado na
  [segunda emenda ao ADR-0005](../../architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md),
  com o gatilho de reabertura escrito.
- **M7** não é implementável e agora se sabe por quê: o módulo de assinatura não
  tem **nenhum** consumidor, nem com a feature ligada. Não há token adquirido,
  logo não há rejeição de provider a detectar. Ligar `blocked()` a um 401 de
  chave de API confundiria duas falhas distintas. A inércia virou verificação de
  CI que reprova no dia em que alguém implementar o fluxo, registrada na
  [emenda ao ADR-0001](../../architecture/decisions/0001-subscription-oauth-is-a-flagged-accepted-risk.md).

O gate final fecha: **97,83% agregado**, contra o piso de 95%, e cada arquivo de
produção fica em pelo menos 90%. Nenhuma exemption `below-floor` foi criada.
Para chegar lá, `consent.rs` ganhou a costura que injeta registro e interlocutor,
`hooks.rs` ganhou testes dos ramos com e sem wrapper, e `session/mod.rs` ganhou o
cenário headless que recusa MCP antes do spawn. O
[ADR-0010](../../architecture/decisions/0010-o-gate-de-cobertura-exige-relatorio-completo-e-fresco.md)
também foi exercitado de verdade: recusou cada relatório que envelheceu durante
as escritas concorrentes e só aprovou o relatório fresco.

## Crítico

| Achado | Onde foi observado | FR | Onda | Estado e teste que protege |
|---|---|---|---|---|
| C1 Servidor MCP do repositório executa sem consentimento | `mcp/config.rs:16`, `nycode-mcp/session.rs:102`, `cli/session.rs:127` | FR-1, FR-2, FR-3 | 3 | FECHADO · `without_an_interlocutor_nothing_new_is_authorized`, `changing_the_command_revokes_the_trust` |
| C2 Hook do repositório executa sem consentimento | `policy/hooks.rs:31`, `policy/hooks.rs:199` | FR-1, FR-2, FR-3 | 3 | FECHADO · `what_identifies_can_differ_from_what_is_shown`, `a_refusal_names_what_was_refused_and_what_it_would_have_run` |
| C3 Extensão herda o ambiente do harness | `nycode-mcp/session.rs:102`, `policy/hooks.rs:199` | FR-18 | 1 | FECHADO · `a_server_does_not_inherit_the_harness_environment`, `a_hook_does_not_inherit_the_harness_environment` |
| C4 Link simbólico contorna a contenção de caminho | `tool.rs:76-107`, `context/instructions.rs:58`, `tools/read.rs:58`, `tools/write.rs:64`, `tools/edit.rs:83` | FR-9, FR-10 | 1 | FECHADO · `blocks_a_symlink_that_leaves_the_root`, `an_instruction_file_that_leaves_the_root_is_not_loaded`, `blocks_a_file_that_does_not_exist_yet_under_a_symlinked_directory` |

## Alto

| Achado | Onde foi observado | FR | Onda | Estado e teste que protege |
|---|---|---|---|---|
| A1 Sessão interativa roda `bash` sem confinamento e sem avisar | `cli/session.rs:172-178`, `cli/interactive.rs:146` | FR-7 | 2 | FECHADO · `an_interactive_session_reaches_bash_without_any_flag`, `an_unconfined_command_tells_the_model_it_was_unconfined` |
| A2 `--allow-writes` concede shell e ferramenta de terceiro | `cli/session.rs:132-134` | FR-11 | 4 | FECHADO · `permission_to_write_is_not_permission_to_run_a_shell`, `permission_to_write_is_not_permission_to_call_a_third_party_tool` |
| A3 Injeção no perfil Seatbelt | `policy/sandbox.rs:176-187` | FR-8 | 1 | FECHADO · `a_workspace_path_cannot_close_the_profile_string`, `a_backslash_in_the_workspace_path_is_escaped_before_the_quote` |
| A4 Hook roda antes do gate, inclusive em sessão somente-leitura | `agent/dispatch.rs:124-128` | FR-14 | 4 | ABERTO · precisa de configuracao de hook, ver Estado |
| A5 Três dos quatro eventos de hook nunca disparam, mas são anunciados | `policy/hooks.rs:107-110`, `cli/session.rs:122` | FR-14 | 4 | FECHADO · `an_event_that_never_fires_is_not_announced_as_active` |

## Médio

| Achado | Onde foi observado | FR | Onda | Estado e teste que protege |
|---|---|---|---|---|
| M1 `(allow default)` no perfil macOS | `policy/sandbox.rs:179` | FR-8 | 2 | FECHADO no relato · `a_policy_that_allows_by_default_says_so_instead_of_passing_for_the_other`, `a_policy_that_allows_by_default_is_not_reported_as_one_that_denies`, `the_three_postures_are_distinguishable_by_strength`. Endurecer o SBPL exige um Mac, ver Estado |
| M2 O timeout não mata o processo | `tools/bash.rs:111`, `policy/hooks.rs:158` | FR-12 | 1 | FECHADO · `dropping_a_running_command_ends_it_instead_of_orphaning_it` |
| M3 `landlock` e `--no-sandbox` prometidos e nunca construídos | ADR-0005 | — | 2 | Emenda da ADR-0005; nada a implementar |
| M4 Binário de confinamento resolvido só pelo `PATH` | `policy/sandbox.rs:115-120` | FR-8 | 2 | FECHADO · `a_binary_planted_ahead_in_the_path_does_not_win_over_the_system_one`, `a_file_without_the_execute_bit_is_not_a_sandbox_binary` |
| M5 Código de saída de hook ignorado em silêncio | `policy/hooks.rs:184` | FR-13 | 1 | FECHADO · aviso em `spawn` |
| M6 stdout de hook sem teto | `policy/hooks.rs:184` | FR-13 | 1 | FECHADO · `a_hook_that_floods_stdout_is_not_buffered_whole` |
| M7 Kill-switch de assinatura nunca é chamado | `nycode-auth/subscription.rs:50` | FR-16 | 4 | FECHADO com veredito · o módulo não tem consumidor, logo não há rejeição a detectar; a inércia virou catraca no job `default-build-has-no-subscription-oauth`. Ver Estado |

## Baixo

| Achado | Onde foi observado | FR | Onda | Estado e teste que protege |
|---|---|---|---|---|
| B1 Destino de servidor HTTP sem validação | `mcp/config.rs:66`, `nycode-ai/config.rs:36` | FR-1 | 4 | FECHADO · `a_repository_that_points_the_server_at_plaintext_off_machine_is_refused`, `a_remote_gateway_in_plaintext_is_refused_before_the_key_is_stored`, `a_host_disguised_by_userinfo_does_not_pass_as_loopback` |
| B2 Credencial em argumento de linha de comando | `cli/main.rs:43`, `parity/runner.rs:34` | FR-15 | 4 | FECHADO · `a_credential_file_keeps_the_secret_out_of_the_process_arguments`, `a_credential_file_the_whole_machine_can_read_is_refused`, `the_credential_cannot_be_given_both_as_an_argument_and_as_a_file` |
| B3 Chave enviada em dois formatos de cabeçalho | `nycode-ai/catalog.rs:41-42` | FR-15 | 4 | FECHADO · `the_catalog_sends_only_the_header_its_dialect_uses`, `a_dialect_that_authenticates_with_bearer_does_not_send_the_other_header` |
| B4 `bash -lc` carrega o profile do usuário | `policy/sandbox.rs:157` | FR-5 | 4 | FECHADO · `the_shell_is_not_a_login_shell` |
| B5 Comentário descreve escopo global inexistente | `mcp/config.rs:15`, `context/skills.rs:22` | — | 4 | FECHADO · correção de comentário; nada a testar |
| B6 Comentário afirma isolamento de SO inexistente | `mcp/tool.rs:74-76` | FR-5 | 3 | FECHADO · `the_confinement_prefix_actually_wraps_the_declared_command` |

## Privacidade

| Achado | Onde foi observado | FR | Onda | Estado e teste que protege |
|---|---|---|---|---|
| P1 `Config` deriva `Debug` sobre `api_key` | `nycode-ai/config.rs:6-13` | FR-15 | 4 | FECHADO · `a_debug_view_of_the_config_never_contains_the_key` |
| P2 `Credential` deriva `Debug` sobre `secret` | `nycode-auth/resolver.rs:22-26` | FR-15 | 4 | FECHADO · `a_debug_view_of_a_credential_never_contains_the_secret` |
| P3 `ServerConfig` deriva `Debug` e `Serialize` sobre `env` | `mcp/config.rs:25-38` | FR-15 | 4 | FECHADO · `a_debug_view_of_a_server_config_never_contains_its_tokens` |
| P4 Transcrito de sessão dentro da árvore versionada | `cli/session.rs:76`, `.gitignore` | FR-17 | 4 | FECHADO · `.nycode/` no `.gitignore` |

Os três primeiros são vazamento **latente**, não observado: a higiene atual está
correta e `cli/session.rs:57` registra a origem da credencial e não o segredo. O
que o teste trava é a próxima linha de log, não uma linha existente.

## Cobertura de requisito

Todo FR da spec tem pelo menos uma linha acima, exceto os que são satisfeitos
por construção e verificados pelos critérios de aceite da própria spec:

| FR | Coberto por |
|---|---|
| FR-1 a FR-4 | C1, C2, B1 |
| FR-5 a FR-8 | A1, A3, B4, M1, M4 |
| FR-9, FR-10 | C4 |
| FR-11 a FR-14 | A2, A4, A5, M2, M5, M6 |
| FR-15 a FR-18 | C3, M7, P1 a P4, B2, B3 |
