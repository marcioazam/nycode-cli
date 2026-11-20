---
description: Descobre se contas Claude Team são Premium ou Standard medindo o medidor de 5h (claude-tier-probe)
argument-hint: "[DIR_DE_CONFIG ...] | --selftest   (padrão: ~/.claude-teams)"
allowed-tools: Bash(claude-tier-probe:*), Read
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do ~/.claude/commands/claude-tier.md. Diferença: o bash do pi não tem
run_in_background nem teto de 10 min; a medição roda em primeiro plano com timeout longo. O probe usa o
CLI `claude` com CLAUDE_CONFIG_DIR de cada pasta, independente do CLAUDE_CONFIG_DIR do pi. -->

Rode o `claude-tier-probe` (`~/.local/bin/claude-tier-probe`) e traga o veredito.

1. Argumentos recebidos: `$ARGUMENTS`. Se vazio, use `~/.claude-teams`. Passe as pastas de config exatamente como o
   usuário escreveu; não adicione `--words` nem `--model`, porque a referência embutida só vale com a carga padrão.
   Não aponte para `~/.pi/agent/claude-home`: essa pasta é a config do pi, não uma conta Claude.
2. `--selftest` roda em segundos e não gasta cota: rode `claude-tier-probe --selftest` na ferramenta `bash` (timeout
   120) e mostre a saída.
3. Qualquer outro caso gasta cota real (~6 min e ~US\$3,6 em preço de lista por conta; as contas rodam em paralelo; uma
   conta Standard termina antes). Antes de rodar, diga ao usuário em uma linha quanto vai custar e quanto vai demorar.
   Depois rode **uma única vez**, em primeiro plano, `claude-tier-probe <pastas>` na ferramenta `bash` com
   `timeout: 3600` (o bash do pi não tem execução em segundo plano; não use `&`, `nohup` nem subagente, e não repita a
   chamada se ela demorar). Se a conta já estiver em uso por outro trabalho, avise que a taxa medida só pode sair
   inflada.
4. Se o bash estourar o timeout ou o probe sair com erro, mostre o fim da saída e pare: não rode de novo sem o usuário
   pedir, porque cada execução gasta cota.
5. Responda em português, começando pelo resultado: a linha "vs referência embutida" de cada conta (Premium, Standard,
   ambígua ou fora das referências) e a linha de razão entre contas, se houver. Depois a tabela e qualquer
   `CONTAMINADA`, `FALHOU` ou "carga grande": explique a causa e o que fazer (repetir quando a conta estiver ociosa, ou
   aguardar o reset da janela de 5h).
6. Não conclua além do que o script imprimiu: "Premium" e "Standard" valem só pela referência embutida (claude-4
   Premium confirmada, medida em 2026-11-08); se o peso do medidor mudar, a referência precisa ser refeita.
