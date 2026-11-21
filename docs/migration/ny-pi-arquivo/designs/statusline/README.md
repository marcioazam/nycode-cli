# Status line "Calmo" (B+)

Estado: aplicado em 2026-11-14, sem commit (o checkout tem mudanças de outros trabalhos). Vale a partir da próxima sessão do pi.

## Objetivo e aceite

Trocar as cinco linhas coloridas do claude-hud por duas linhas monocromáticas, onde cor só aparece como alerta.

- Linha 1: modelo, raciocínio, pasta, branch e sujo; depois, à esquerda e atrás de um `│`, tempo e custo.
- Linha 2: `ctx` com barra de 8 células. Linha 3: `5h` e `semana`, com a mesma barra, separados por ` · `. A barra fica sempre; em terminal estreito a nota encurta e depois some.
- Cada janela diz quando renova (`renova em 4h`; estreito: `↻ 4h`), pedido do dono 2026-11-14; substitui a nota `nesse ritmo acaba em …`. ~~Atenção (amarelo) a partir de 70% ou quando o ritmo leva a 100% antes da renovação (só o `▲`); crítico (vermelho) a partir de 85%.~~ Substituído em 2026-11-14 (pedido do dono): quatro cores em barra e percentual, verde pouco, amarelo cuidado, roxo muito, vermelho excesso ou quase chegando. Limiares: contexto 40/60/80, uso 50/75/90; ritmo alto (`▲`) sobe verde para amarelo; `compacta em breve` é vermelho. O aviso `⚠ bypass ligado` passou a vermelho (`error`).
- Cores (pedido do dono 2026-11-14, substitui as quatro cores acima): as do claude-hud 0.10.0 com a paleta do tema do pi. Contexto verde (`success`) <70%, amarelo (`warning`) 70–85%, vermelho (`error`) ≥85% ou `compacta em breve`. Uso azul (`accent`) <75%, roxo (`mdCode`) 75–90% ou ritmo projetado ≥90%, vermelho ≥90% ou ritmo >100%; `▲` na cor do ritmo. Trilho em `borderMuted`.
- Linha de aviso só quando há problema: `⚠ cache N%` abaixo de 50%.
- `compacta em breve` quando o contexto passa de 85% do limite de compactação do modelo (`compaction.reserveTokens`).
- Limites lidos há mais de 10 minutos: barras apagadas e `limites de … atrás`.
- `"level": "detalhe"` abre o painel (contexto, 5h, semana, cache, tokens, alterações, sessão).

## O que mudou

| Arquivo | Mudança |
|---|---|
| `claude-home/bin/hud/calm-statusline.mjs` | renderizador novo (sem dependência do claude-hud) |
| `claude-home/bin/hud/claude-hud-statusline.mjs`, `claude-home/plugins/claude-hud/statusline.mjs` | `"renderer": "calm"` na config escolhe o renderizador novo; sem a chave, segue o claude-hud |
| `claude-home/bin/hud/claude-hud-usage.mjs` | o cache guarda `ok` (última leitura bem-sucedida) e o payload leva `rate_limits_at` |
| `claude-home/bin/hud/tests/calm-statusline.test.mjs`, `claude-hud-usage.test.mjs` | testes |
| `themes/tokyo-night.json` | `dark5` `#737aa2` → `#8a93bd` (4,1:1 → 5,7:1 sobre `#1a1b26`); afeta `dim`, `thinkingText`, `mdQuote` |
| `publish.list` | duas linhas do renderizador e do teste |
| `~/.pi/agent/claude-home/plugins/claude-hud/config.json` | `"renderer": "calm"`, `"level": "padrao"` (cópia anterior em `/tmp/hud-config.json.bak-calm`) |

Contrato alterado: o teste do cache de uso exigia as chaves `at` e `rate_limits`; agora aceita também `ok` (um horário, nunca token). O `extensions/auto-resume` lê só `rate_limits` e segue compatível.

## Não aplicado

- Contagem de agentes ativos na linha 1: o dado fica no painel de subagentes, que não deve ser mexido.
- Aviso de servidor MCP fora do ar: o payload não traz esse estado.
- Abrir o detalhe por clique ou seta: exige patch no pi-code; hoje é a chave `level`.
- Comando `/statusline`: `/claude-hud-configure` continua configurando só o claude-hud.
- ~~Cores fixas do Tokyo Night no renderizador~~ (superado 2026-11-14): o renderizador lê o tema de `settings.json` (par claro/escuro por `COLORFGBG`, senão escuro; o OSC 11 que o pi usa não chega ao processo filho).

## Evidência

- `node --test claude-home/bin/hud/tests/*.test.mjs`: ver a resposta da entrega.
- `node docs/designs/statusline/check.mjs` → `real-calm.png` (kitty real, provider fake, sem limites por não haver credencial).
- `variantes.html`: mocks aprovados.

## Rollback

Remover `"renderer"` de `~/.pi/agent/claude-home/plugins/claude-hud/config.json` volta ao claude-hud. Tema: `dark5` de volta a `#737aa2`.

## Sincronia do 5h e da semana sem input (2026-11-18)
Defeito: o status line só rodava em eventos da sessão (início, mensagem, turno, compactação, renovação de janela). Parado
(esperando você ou o limite de uso), os números congelavam; e na anthropic o header do pi vencia e a API nunca era lida,
então o uso de outras sessões da mesma conta não aparecia.
- `statusLine.refreshInterval: 60` (`claude-home/settings.json.example` e o `settings.json` instalado): o pi-code roda o
  status line a cada 60 s também parado; mudar o arquivo vale na hora (o pi-code observa o arquivo).
- `claude-hud-usage.mjs` `mergeWindows`: header do pi e API juntos. Janela com `resets_at` 1 h ou mais adiante é mais
  nova e vence; na mesma janela vale o maior uso, porque dentro da janela o uso só cresce. Fonte única entre sessões: o
  cache de 60 s em `usage-cache.json`, então N sessões fazem cerca de 1 pedido por minuto, não N.
- Idade máxima do número parado: cerca de 2 min (60 s do cache mais 60 s do intervalo). Após uma resposta o header atualiza
  na hora.
- Contrato antigo superado: "header do pi vence e pula o pedido" (teste em `claude-hud-usage.test.mjs`, substituído).
- `PI_CODING_AGENT_DIR` passa a valer para o `auth.json` lido pelo HUD; o teste ponta a ponta usa uma pasta isolada e não
  consulta a API real.
