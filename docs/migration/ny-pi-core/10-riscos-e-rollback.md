# Riscos e reversão da migração

Registro de riscos, reversão por fase, critérios de parada, pré-mortem e convivência em F12. Fonte dos fatos: os
documentos canônicos ([00](00-mega-plano.md), [02](02-arquitetura-alvo.md), [11](11-decisoes-e-pendencias.md), anexos
[A](anexos/A-inventario-ny-pi.md) e [B](anexos/B-mapa-core-nycode.md)) e a política de sincronização
([08](08-sincronizacao-upstream.md)). Estado: **plano**; nada foi implementado nem executado, e nenhuma medição de risco
é de campo. Probabilidade e impacto são julgamento do autor do plano (A = alta, M = média, B = baixa), não medição.

Legenda de donos: **Dono** = Marcio (autorização e aceite); **Orq.** = sessão orquestradora; **Exec.** = executor da
unidade; **Seg.** = `security-reviewer`; **Entrega** = `git-delivery`. Identificadores D-nn, K1..K14, P-n e F0..F12
são os dos documentos canônicos; PC-n vêm de [08](08-sincronizacao-upstream.md).

Rótulos: "documento" = afirmado em documento canônico; "medido" = verificado ao escrever; "não verificado" = sem
verificação possível agora.

## 1. Registro de riscos

O registro está dividido em três tabelas com o mesmo identificador: 1.1 (o que é o risco), 1.2 (como notar e conter) e
1.3 (como reverter). Larguras de coluna curtas são deliberadas.

### 1.1 Risco, causa, fase, probabilidade, impacto e dono

| ID | Risco | Causa | Fase | P | I | Dono |
|---|---|---|---|---|---|---|
| R-01 | Troca de base 1.5.2 para 1.6.0 muda comportamento | D-25: base e migração juntas | F3 | M | A | Orq. |
| R-02 | Subagent embutido diverge do pi-code remendado | 19 patches, 8,5 mil linhas | F6 | M | A | Exec. |
| R-03 | `ExtensionAPI` do 1.6.0 difere da usada na 1.5.2 | P-3, eventos mudaram | F5 | M | M | Exec. |
| R-04 | Costuras K1..K14 conflitam a cada sincronização | Edição em arquivo do upstream | F4-F12 | M | M | Orq. |
| R-05 | Renome (2316 arquivos) conflita com todo merge | `f523ebd25`; script só em `/tmp` | F0 | A | A | Dono |
| R-06 | Regra linear do ruleset impede fundir o upstream | D-07: squash perde ancestral | F3 | M | A | Dono |
| R-07 | Ruleset ativo antes do import bloqueia o histórico | Ordem F1 antes de F3 violada | F1 | B | A | Dono |
| R-08 | Guard nativo deixa passar comando que `guard.py` negava | D-08: porta incompleta | F8 | M | A | Seg. |
| R-09 | Motor de permissão falha ao iniciar e libera chamadas | Erro de carga do motor | F8 | B | A | Seg. |
| R-10 | `python3` ou `jq` ausentes na máquina do usuário | Hooks fase A dependem deles | F8 | M | M | Exec. |
| R-11 | Instrução sempre carregada cresce | Texto movido para `resources/` | F8 | M | M | Exec. |
| R-12 | Skills opcionais entram no contexto por padrão | Classe `optional` mal aplicada | F8 | M | M | Exec. |
| R-13 | Custo e fila do benchmark estouram | Rodadas `full` por fase | F3, F10 | M | M | Dono |
| R-14 | Runner local do `bench-pr` parado bloqueia PRs | Status obrigatório sem workflow | F3 | M | A | Dono |
| R-15 | Conta de benchmark indisponível ou limitada | Conta `claude` única, em fila | F3, F10 | M | M | Dono |
| R-16 | ~~Escopo npm `@nycode` indisponível~~ (D-17: sem npm; canal do repositório) | Risco passa a ser Release recusado ou `publish.yml` sem permissão (06, "Se der errado" 10) | F11 | B | M | Dono |
| R-17 | Publicação sem proveniência | `actions/attest` ausente no `publish.yml` ou atestação que não verifica | F11 | M | A | Seg. |
| R-18 | `pi.dev` fora do ar ou catálogo incompatível | D-12: serviço do upstream | F11 | B | M | Orq. |
| R-19 | Perda de dados em `nycode migrate from-pi` | Sobrescrita de auth, sessões, MCP | F4, F12 | B | A | Seg. |
| R-20 | Dois harnesses disputam `~/.pi` e `~/.nycode` | Convivência em F12 | F12 | M | M | Dono |
| R-21 | Licenças de terceiros sem atribuição | MIT do pi-code e pi-lsp, Apache-2.0 | F5, F9 | M | M | Exec. |
| R-22 | Identificador pessoal vaza ao importar o histórico | Histórico do ny-pi entra no nycode | F1 | B | M | Seg. |
| R-23 | 8 alertas de secret scanning continuam abertos | D-16 aguarda o dono | F0 | A | B | Dono |
| R-24 | Apagar ramo errado dos 213 herdados | D-15, apagar em lote | F0 | B | M | Dono |
| R-25 | Limite 800/7 quebra arquivos importados | pi-code tem arquivo de 1392 linhas | F5 | A | B | Exec. |
| R-26 | Formatação em massa esconde mudança real | Biome do fork reformata o importado | F5 | M | M | Exec. |
| R-27 | Mudança visual da UI sem querer | Regra do dono: UI não muda | F7 | M | A | Dono |
| R-28 | Bus factor: um único mantenedor | Todas as autorizações no dono | F0-F12 | A | M | Dono |
| R-29 | `build-check` falha sem tag `v*.*.*` | P-6 | F0 | A | B | Exec. |
| R-30 | Atraso do upstream acumula | 944 arquivos por semana medidos | F4-F12 | M | M | Orq. |
| R-31 | `import/` entra no build ou no pacote | Fora do `workspaces` mal configurado | F1 | B | M | Exec. |
| R-32 | `ny-pi` congelado recebe correção que não migra | Congelamento até F12 | F0-F12 | B | M | Orq. |
| R-33 | PR de correção K1 e K2 ao upstream é fechado | CONTRIBUTING fecha PR sem `lgtm` | F4 | A | B | Dono |
| R-34 | Patch do `pi-lsp` (4080 linhas) vira dívida | Código de terceiros com patch local | F9 | M | M | Exec. |

### 1.2 Sinal de alerta e contenção

| ID | Sinal de alerta observável | Contenção |
|---|---|---|
| R-01 | Braço `ny-pi@1.6.0` difere da referência do ny-pi | Medir "ny-pi por fora sobre 1.6.0" em F3 (D-25) |
| R-02 | Teste de frota ou times falha após a cópia | Cópia byte a byte, depois imports, depois formatação |
| R-03 | `npm run check` falha nos tipos de evento | Corrigir na primeira unidade de F5 (P-3) |
| R-04 | `check-seams.sh` abaixo de 14/14 | Marcador, teste por costura ([08](08-sincronizacao-upstream.md#costuras)) |
| R-05 | Merge direto do upstream com muitos conflitos | Imagem renomeada; script em `scripts/fork/` na F0 |
| R-06 | Merge commit em `main` sem imagem válida | Job `merge-policy`; squash para o resto |
| R-07 | Merge do histórico recusado por regra | Ordem F1 antes de F3; checar ruleset desativado |
| R-08 | Teste diferencial dos motores diverge | Padrão `script`; nativo só com 100% do corpus e fuzz |
| R-09 | Sessão sem negar comando perigoso | Falha fechada: motor com erro nega a chamada (D-08) |
| R-10 | `python3` ou `jq` sem resposta no `doctor` | `nycode doctor` avisa; fase B remove Python |
| R-11 | `instruction_budget.py check` reprova | Orçamento e linha de base migram junto |
| R-12 | Tamanho do contexto inicial maior que a linha de base | Classe da 0005; `core_scope.py` confere |
| R-13 | Gasto da conta acima do orçado | `smoke` por PR, `full` por fase; `est_cost_usd` |
| R-14 | Status `bench-pr` pendente por horas | Verificador local como serviço; D-21 para PR sem código |
| R-15 | Erro de autenticação ou limite no bench | Fila única; rodar quando a conta voltar |
| R-16 | `publish.yml` falha ou deixa o Release em rascunho | `gh release delete v2.0.0 --cleanup-tag`, corrigir por PR e reetiquetar (06, "Se der errado" 10) |
| R-17 | Release publicado sem selo de origem | `gh attestation verify` por arquivo é parte da saída de F11; sem atestação o Release volta a rascunho |
| R-18 | Falha ao listar modelos, OAuth ou instalador | Catálogo em cache; aviso de versão próprio |
| R-19 | `migrate from-pi` sem `--dry-run` limpo | Cópia, nunca move; backup; sem tocar auth |
| R-20 | Sessão do `pi` e do `nycode` no mesmo diretório | Diretórios distintos; migração por cópia |
| R-21 | `NOTICE` sem a origem de um componente | P-4; conferir `NOTICE` em cada fase |
| R-22 | `check-leaks.sh --history` acusa | Rodar no clone filtrado antes do merge, mesmo o histórico sendo público |
| R-23 | Alertas abertos no painel de segurança | Fechar como credencial pública de cliente (D-16) |
| R-24 | Ramo com PR aberto na lista de exclusão | Conferir PR por ramo antes de apagar |
| R-25 | `structure_changed` reprova arquivo importado | Lista de base no commit de cópia (D-06) |
| R-26 | Diff de PR com milhares de linhas de formato | Três commits: cópia, imports, formatação |
| R-27 | Captura de tela difere do ny-pi | Comparar telas antes e depois; defeito visual bloqueia |
| R-28 | Dono indisponível; PR parado | Fases em PRs pequenos; checklist mestre atualizado |
| R-29 | `build-check` vermelho em `main` | Etiqueta `v1.6.0-base` em F0 |
| R-30 | Atraso acima de 14 dias | Sincronização semanal; ver [08](08-sincronizacao-upstream.md) |
| R-31 | Arquivo de `import/` no pacote publicado | `import/` fora de `workspaces`, `files` e gates |
| R-32 | Commit em `ny-pi/main` depois do congelamento | Só segurança; cada um vira item no checklist |
| R-33 | Issue fechada sem resposta | Manter a costura; baixo risco (K1, K2) |
| R-34 | Extensão `lsp` com testes vermelhos | Tratar como código próprio; testes migram |

### 1.3 Reversão

| ID | Plano de reversão |
|---|---|
| R-01 | Voltar ao `pi` 1.5.2 do ny-pi (continua instalado até F12) |
| R-02 | Desligar a extensão `subagent` em `nycode config`; usar o `pi` |
| R-03 | Reverter o PR da extensão; manter o `pi` |
| R-04 | Reverter a costura (PR de squash); extensão embutida segue |
| R-05 | Parar de sincronizar até o pipeline existir; manter base 1.6.0 |
| R-06 | Reverter o merge commit (`git revert -m 1`); recriar proteção |
| R-07 | Desativar o ruleset; fundir o histórico; reativar |
| R-08 | Chave `permissions.engine` de volta a `"script"` |
| R-09 | Idem; sem os dois motores, o padrão é negar |
| R-10 | Instalar as dependências ou usar a fase B quando existir |
| R-11 | Reverter o PR que aumentou o texto |
| R-12 | Reverter a classe; desligar a skill |
| R-13 | Parar as rodadas; reduzir a `smoke` |
| R-14 | Reiniciar o serviço; D-21 enquanto isso |
| R-15 | Pausar as fases com gate; não ligar a conta à força |
| R-16 | Usar o escopo alternativo; nada publicado ainda |
| R-17 | `npm deprecate`; republicar com versão nova |
| R-18 | Voltar ao instalador do `pi`; catálogo em cache |
| R-19 | Restaurar do backup do `~/.nycode`; `~/.pi` intacto |
| R-20 | Voltar a usar só o `pi`; `~/.nycode` descartável |
| R-21 | Corrigir `NOTICE` em PR; remover componente sem licença clara |
| R-22 | Não fundir; refazer o filtro sem o arquivo |
| R-23 | Reabrir o alerta no GitHub |
| R-24 | Recriar o ramo pelo SHA registrado antes |
| R-25 | Atualizar a lista de base em PR |
| R-26 | Reverter o terceiro commit (formatação) |
| R-27 | Reverter o PR; restaurar o componente visual |
| R-28 | Congelar a migração no último PR verde |
| R-29 | Criar a etiqueta; reexecutar o CI |
| R-30 | Sincronização de emergência antes de qualquer PR |
| R-31 | Reverter o merge ou remover o caminho do pacote |
| R-32 | Reaplicar a correção no nycode por PR |
| R-33 | Nenhuma; a costura continua |
| R-34 | Tratar como código próprio; reduzir o patch em PRs |

## 2. Reversão por fase

Princípio: cada fase termina em PR verde e reversível (princípio 5 do mega plano). O `pi` do ny-pi continua instalado e
utilizável até F12 (documento: princípio 2). Todo comando abaixo é proposta e **não foi executado**; as ações que
escrevem no GitHub (reverter, apagar, recriar proteção) exigem a autorização do dono e rodam pelo `git-delivery`.

| Fase | O que desfaz | Até quando é possível |
|---|---|---|
| F0 | Apagar a etiqueta `v1.6.0-base`; recriar ramos pelo SHA; reabrir alertas | Sempre, se os SHAs foram guardados |
| F1 | `git revert -m 1` do merge commit; nada fora de `import/ny-pi/` muda | Até um `git mv` sair de `import/` |
| F2 | Revert do PR de squash; logo e README voltam como eram | Sempre |
| F3 | `DELETE` do ruleset e recriar a proteção clássica pelo JSON de `evidencias/` | Enquanto o JSON existir |
| F4 | Revert do PR de cada costura; a migração de dados é por cópia e não altera `~/.pi` | Sempre |
| F5 | Desligar a extensão em `nycode config`; revert do PR; usar o `pi` | Sempre |
| F6 | Idem a F5; subagentes voltam ao pi-code do ny-pi | Sempre |
| F7 | Idem a F5, extensão a extensão; K10 por revert | Sempre |
| F8 | Motor de permissão para `"script"`; revert dos recursos | Sempre |
| F9 | Desligar `lsp`; opcionais saem de `nycode install` | Sempre |
| F10 | Revert do PR que regrava `docs/bench/baseline-main/` | Sempre |
| F11 | Reversível: o Release e a etiqueta se apagam (`gh release delete --cleanup-tag`); a atestação fica no Sigstore público | Ver ponto sem volta |
| F12 | Desarquivar o `ny-pi`; restaurar `import/ny-pi/` por git; `pi` do dia a dia volta | Enquanto o `ny-pi` existir |

Detalhes por fase, para quem executa:

- **F0.** Antes de apagar qualquer ramo (D-15), gravar a lista de ramos e SHAs em `evidencias/F0.md`; cada ramo é
  recriado com `git push origin <sha>:refs/heads/<nome>`. A etiqueta se apaga com
  `git push origin :refs/tags/v1.6.0-base`.
- **F1.** O merge de histórico não relacionado é um commit; `git revert -m 1 <merge>` o desfaz sem tocar o resto. Se o
  ruleset do ny-pi já estiver ativo, o merge nem entra (R-07): a ordem é F1 antes de F3.
- **F3.** Antes de ativar o ruleset, guardar em `evidencias/` o JSON atual da proteção clássica (checks `build-check`,
  `test (coding-agent|durable|chord|other)`, `mcp-conformance`; documento: anexo A e mega plano, seção 3). Reverter:
  `DELETE` do ruleset e recriação da proteção a partir do JSON. Se o ruleset bloquear a própria reversão, remover o
  ruleset pela interface do dono.
- **F4 a F9.** A extensão embutida se desliga em `nycode config` ("Built-in extensions", documento: arquitetura alvo,
  seção 1). Costura de core (K1 a K14): revert do PR de squash correspondente; cada costura tem seu teste e seu PR (08).
- **F11.** Reverter a infraestrutura (instalador, binários, Nix) é revert de PR. O que já foi para o npm não volta.
- **F12.** Arquivar o `ny-pi` é reversível (desarquivar no GitHub); apagar `import/ny-pi/` é reversível por git (o
  histórico fica). O `pi` do ny-pi continua instalado até F12 (documento: princípio 2).

### 2.1 Ponto sem volta

- **Publicação do Release `v2.0.0` (F11) é reversível no GitHub, não no mundo.** O Release e a etiqueta se apagam
  (`gh release delete v2.0.0 --cleanup-tag`) e a imutabilidade de Release está desligada (`enabled: false` em
  2026-11-21), mas quem já baixou o binário o mantém e a atestação segue nos registros públicos (comportamento do
  Sigstore, não verificado). O número `2.0.0` (D-13) deve ser tratado como consumido depois de publicado: a correção sai
  como `2.0.1`. O npm deixou de ser canal (D-17), então `npm deprecate` e `unpublish` não se aplicam.
- **Arquivar o `ny-pi` (F12)** é reversível: o GitHub permite desarquivar (comportamento do GitHub, não verificado
  nesta etapa).
- **Apagar `import/ny-pi/`** é reversível por git: o histórico da pasta continua em `main`.
- **Apagar ramos (F0)** é reversível se o SHA foi gravado; sem o SHA, depende do `reflog` remoto, que o GitHub não expõe
  (não verificado).
- Portanto, o primeiro ponto de difícil volta é o primeiro download do Release `v2.0.0`. Antes dele, só F11 pode ser
  interrompida sem custo; depois, o rollback passa a ser "publicar versão corrigida".

## 3. Critérios de parada

Interromper a migração, congelar a fase em curso e voltar ao `pi` do ny-pi quando **qualquer** destes for verdade:

1. Um gate de segurança falha duas vezes em sequência na mesma unidade (F4 e F8: o `security-reviewer` reprova após uma
   correção).
2. O motor nativo de permissão deixa passar um comando que `guard.py` nega, em qualquer item do corpus ou do fuzz com
   semente fixa (D-08); a chave volta a `"script"` e F8 fase B para.
3. O braço `nycode` do benchmark fica abaixo da referência em acerto na segunda rodada seguida do `tier full`, sem
   causa de base (D-25) explicada (critério 4 do mega plano).
4. A migração de dados do usuário perde ou sobrescreve um arquivo de `~/.pi` (R-19): para a F4 e a F12 até haver teste
   que o impeça.
5. Uma sincronização do upstream fica pendente por mais de 28 dias, o dobro do atraso máximo (08, seção 3), e a fusão
   acumulada passa de 50 arquivos em conflito (limiar proposto, a calibrar com as duas primeiras sincronizações).
6. O `merge-policy` reprova a mesma fusão válida duas vezes (imagem não reprodutível), e o pipeline de renome não pode
   ser corrigido em um PR.
7. O dono suspende por escrito, ou o orçamento de benchmark do período acaba (R-13, R-15).
8. Uma diferença visual não autorizada na UI não é revertida em 2 PRs (R-27).
9. A F11 não consegue publicar o Release nem atestar os arquivos (D-17, D-42): F11 e F12 param; F0 a F10 permanecem.

Os limiares numéricos dos itens 1, 3, 5 e 8 são propostas deste plano, não valores medidos.

## 4. Pré-mortem

Suposição: a migração falhou. Três histórias plausíveis e o que o plano faz para evitá-las.

1. **"O harness chegou, mas se comporta diferente e ninguém sabe por quê."** O nycode foi cortado em F12 com acerto e
   custo piores que o ny-pi. Causa: a base mudou (1.5.2 para 1.6.0) e o código migrou na mesma onda, então a regressão
   não tem dono. O plano evita assim: D-25 mede o ny-pi por fora sobre 1.6.0 antes de migrar (F3); o princípio 1
   (paridade antes de melhoria) e a cópia byte a byte de F5 e F6 separam mudança de lugar de mudança de código; o gate
   de F10 e o critério 4 comparam com a referência; D-14 remede `pi-vanilla` e `cc-vanilla`.
2. **"O fork parou de acompanhar o upstream."** Depois do corte, o custo de sincronizar ficou tão alto (renome em 2316
   arquivos, 14 costuras, 944 arquivos por semana) que ninguém mais sincronizou, e o nycode virou um fork morto. O plano
   evita assim: [08](08-sincronizacao-upstream.md) mede o ritmo, fixa cadência semanal e atraso máximo, versiona o
   pipeline de renome (PC-1), troca o conflito de renome pela imagem determinística, mantém as costuras em lista fechada
   com teste, e exige duas sincronizações completas depois de F6 como critério 7. O bus factor (R-28) é o fator
   agravante; a documentação e o `evidencias/sync-*.md` existem para outra pessoa ou agente refazer o ciclo.
3. **"A segurança regrediu em silêncio e dados do usuário se perderam."** O motor nativo de permissão foi ligado sem
   paridade, ou `nycode migrate from-pi` sobrescreveu `auth.json` ou sessões. Causa: pressa para tirar o Python do
   caminho e o wrapper do dia a dia. O plano evita assim: D-08 em duas fases com o corpus de `test_guard.py` como
   oráculo e falha fechada; `migrate from-pi` por cópia, nunca move, com ensaio (`--dry-run`, proposto) e backup, e
   nunca toca `auth*.json`, `mcp.json` nem `sessions/` do destino (R-19); revisão de segurança obrigatória em F4 e
   F8; `pi` continua instalado até
   F12 como saída.

## 5. Convivência em F12

Objetivo: o `nycode` substituir o `pi` no dia a dia sem perder a saída de volta.

### 5.1 Duas instalações

- `pi`: wrapper em `~/.local/bin/pi` e launcher em `~/.pi/agent/bin/pi`, dados em `~/.pi/agent` (documento: anexo A,
  seção 1 e seção 5). Fica instalado e **não é alterado** durante a convivência.
- `nycode`: binário `nycode`, dados em `~/.nycode/agent` (documento: anexo B, seção 2). Os nomes de comando e de
  diretório são diferentes, então não há colisão de binário nem de diretório.
- `nycode migrate from-pi` **copia** os dados para `~/.nycode/agent`; nada é movido nem apagado em `~/.pi` (D-09).
  Nunca sobrescreve `auth.json`, `mcp.json` nem `sessions/` já existentes no destino; faz backup do destino antes.

### 5.2 Como alternar

| Quero usar | Comando | Observação |
|---|---|---|
| O harness antigo | `pi` | Usa `~/.pi/agent`; não lê `NYCODE_*` |
| O harness no core | `nycode` | Usa `~/.nycode/agent`; não lê `PI_*` (D-09) |
| Isolar uma sessão do `nycode` | `NYCODE_CODING_AGENT_DIR=<dir> nycode` | Variável já existe no fork (anexo B) |
| Voltar de vez | Parar de usar `nycode`; `~/.nycode` fica de reserva | `~/.pi` está intacto |

Regra: nunca abrir a mesma sessão nos dois programas (os formatos de sessão podem divergir; não verificado). Para
retomar um trabalho no outro programa, iniciar uma sessão nova.

### 5.3 Por quanto tempo: critério por sessões, não por data

Proposta (os números são a calibrar; **não medidos**):

1. **Sessões contadas:** sessões reais de trabalho no `nycode`, cada uma com ao menos 1 chamada de ferramenta e
   encerrada normalmente. Sessões de teste e de benchmark não contam.
2. **Regressão:** qualquer defeito que o mesmo trabalho não teria no `pi`, confirmado ao repetir o passo no `pi`.
   Também conta: uma diferença visual da UI (R-27), um comando que o guard deixou passar (R-08) e perda de dado.
3. **Critério de saída:** 50 sessões consecutivas sem regressão, das quais ao menos 10 em modo `print` (`-p`), 10 com
   `subagent` e 5 com `plan-mode`, e ao menos uma sincronização do upstream feita nesse período.
4. **Reinício da contagem:** uma regressão zera a contagem e abre um registro em `evidencias/F12.md`. Duas regressões
   de segurança ou de perda de dado acionam o critério de parada 2 ou 4 (seção 3).
5. **Depois do critério:** arquivar o `ny-pi` (D-22, autorização do dono) e remover `import/ny-pi/` por PR; o `pi` pode
   ser desinstalado só depois, a pedido do dono.

Durante a convivência, o `ny-pi` segue congelado: entra só correção de segurança (F0), e cada uma é reaplicada no
nycode por PR (R-32).

## 6. Não verificado neste documento

- Prazo de 72 horas do `npm unpublish` e a regra atual do registro; comportamento exato de desarquivar um repositório
  no GitHub.
- Divergência de formato de sessão entre `pi` e `nycode`.
- Todos os valores de probabilidade e impacto (julgamento) e os limiares numéricos das seções 3 e 5.3.
- Se o GitHub aceita `DELETE` do ruleset e recriação da proteção clássica sem perder a configuração de checks (depende
  de o JSON guardado ser completo; o anexo D guarda as regras brutas, não relidas aqui).
- Estado atual do escopo `@nycode` no npm (o mega plano registra 404 em 2026-11-20; não reconsultado).
