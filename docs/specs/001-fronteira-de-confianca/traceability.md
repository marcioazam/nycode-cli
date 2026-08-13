# traceability — fronteira de confiança do agente

Cada achado da auditoria alcança um requisito da [`spec.md`](spec.md), uma onda
do [`plan.md`](plan.md) e um teste que o protege. Uma linha sem teste é um
requisito que ninguém vai perceber quando regredir.

Os nomes de teste estão em inglês e descrevem o comportamento protegido, como o
[`AGENTS.md`](../../../AGENTS.md) exige.

## Crítico

| Achado | Onde foi observado | FR | Onda | Teste que protege |
|---|---|---|---|---|
| C1 Servidor MCP do repositório executa sem consentimento | `mcp/config.rs:16`, `nycode-mcp/session.rs:102`, `cli/session.rs:127` | FR-1, FR-2, FR-3 | 3 | `an_undeclared_server_is_not_spawned_before_the_user_consents` |
| C2 Hook do repositório executa sem consentimento | `policy/hooks.rs:31`, `policy/hooks.rs:199` | FR-1, FR-2, FR-3 | 3 | `a_hook_the_user_never_approved_is_not_executed` |
| C3 Extensão herda o ambiente do harness | `nycode-mcp/session.rs:102`, `policy/hooks.rs:199` | FR-18 | 1 | `an_extension_does_not_inherit_the_harness_credentials` |
| C4 Link simbólico contorna a contenção de caminho | `tool.rs:76-107`, `context/instructions.rs:58`, `tools/read.rs:58`, `tools/write.rs:64`, `tools/edit.rs:83` | FR-9, FR-10 | 1 | `a_symlink_pointing_outside_the_root_is_refused`, `an_instruction_file_that_leaves_the_root_is_not_loaded` |

## Alto

| Achado | Onde foi observado | FR | Onda | Teste que protege |
|---|---|---|---|---|
| A1 Sessão interativa roda `bash` sem confinamento e sem avisar | `cli/session.rs:172-178`, `cli/interactive.rs:146` | FR-7 | 2 | `a_session_that_can_reach_bash_is_warned_even_without_allow_writes`, `an_unconfined_command_tells_the_model_it_was_unconfined` |
| A2 `--allow-writes` concede shell e ferramenta de terceiro | `cli/session.rs:132-134` | FR-11 | 4 | `permission_to_write_is_not_permission_to_run_a_shell` |
| A3 Injeção no perfil Seatbelt | `policy/sandbox.rs:176-187` | FR-8 | 1 | `a_workspace_path_cannot_rewrite_the_sandbox_profile` |
| A4 Hook roda antes do gate, inclusive em sessão somente-leitura | `agent/dispatch.rs:124-128` | FR-14 | 4 | `a_hook_is_not_invoked_for_a_tool_it_does_not_watch` |
| A5 Três dos quatro eventos de hook nunca disparam, mas são anunciados | `policy/hooks.rs:107-110`, `cli/session.rs:122` | FR-14 | 4 | `only_an_event_that_fires_is_announced_to_the_user` |

## Médio

| Achado | Onde foi observado | FR | Onda | Teste que protege |
|---|---|---|---|---|
| M1 `(allow default)` no perfil macOS | `policy/sandbox.rs:179` | FR-8 | 2 | `the_macos_profile_denies_by_default_rather_than_allowing` |
| M2 O timeout não mata o processo | `tools/bash.rs:111`, `policy/hooks.rs:158` | FR-12 | 1 | `a_command_that_exceeds_the_timeout_is_actually_dead` |
| M3 `landlock` e `--no-sandbox` prometidos e nunca construídos | ADR-0005 | — | 2 | Emenda da ADR-0005; nada a implementar |
| M4 Binário de confinamento resolvido só pelo `PATH` | `policy/sandbox.rs:115-120` | FR-8 | 2 | `confinement_is_not_reported_as_enforced_when_it_cannot_be_trusted` |
| M5 Código de saída de hook ignorado em silêncio | `policy/hooks.rs:184` | FR-13 | 1 | `a_hook_that_exits_nonzero_says_so` |
| M6 stdout de hook sem teto | `policy/hooks.rs:184` | FR-13 | 1 | `a_hook_that_never_stops_writing_does_not_exhaust_memory` |
| M7 Kill-switch de assinatura nunca é chamado | `nycode-auth/subscription.rs:50` | FR-16 | 4 | `a_provider_rejection_disarms_the_subscription_path` |

## Baixo

| Achado | Onde foi observado | FR | Onda | Teste que protege |
|---|---|---|---|---|
| B1 Destino de servidor HTTP sem validação | `mcp/config.rs:66`, `nycode-ai/config.rs:36` | FR-1 | 4 | `a_plaintext_endpoint_outside_loopback_is_refused` |
| B2 Credencial em argumento de linha de comando | `cli/main.rs:43`, `parity/runner.rs:34` | FR-15 | 4 | `a_credential_can_be_supplied_without_appearing_in_the_process_list` |
| B3 Chave enviada em dois formatos de cabeçalho | `nycode-ai/catalog.rs:41-42` | FR-15 | 4 | `the_catalog_authenticates_with_the_dialect_header_only` |
| B4 `bash -lc` carrega o profile do usuário | `policy/sandbox.rs:157` | FR-5 | 4 | `the_confined_shell_does_not_source_the_user_profile` |
| B5 Comentário descreve escopo global inexistente | `mcp/config.rs:15`, `context/skills.rs:22` | — | 4 | Correção de comentário; nada a testar |
| B6 Comentário afirma isolamento de SO inexistente | `mcp/tool.rs:74-76` | FR-5 | 3 | Coberto por `an_mcp_server_runs_confined` |

## Privacidade

| Achado | Onde foi observado | FR | Onda | Teste que protege |
|---|---|---|---|---|
| P1 `Config` deriva `Debug` sobre `api_key` | `nycode-ai/config.rs:6-13` | FR-15 | 4 | `a_debug_view_of_the_config_never_contains_the_key` |
| P2 `Credential` deriva `Debug` sobre `secret` | `nycode-auth/resolver.rs:22-26` | FR-15 | 4 | `a_debug_view_of_a_credential_never_contains_the_secret` |
| P3 `ServerConfig` deriva `Debug` e `Serialize` sobre `env` | `mcp/config.rs:25-38` | FR-15 | 4 | `a_debug_view_of_a_server_config_never_contains_its_tokens` |
| P4 Transcrito de sessão dentro da árvore versionada | `cli/session.rs:76`, `.gitignore` | FR-17 | 4 | `session_artifacts_do_not_land_in_the_users_tracked_tree` |

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
