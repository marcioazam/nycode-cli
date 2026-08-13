# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.
Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) ·
[Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- **NFR-8 — segurança precede performance, com consequência e não como slogan.**
  As duas estavam em níveis documentais diferentes sem que ninguém tivesse
  decidido isso: performance era NFR-1 a NFR-3, cada um com orçamento e gate,
  enquanto segurança não era NFR nenhum — aparecia como FR-10 e FR-11, como
  `unsafe_code = "forbid"`, e como o job `supply-chain`. Enquanto os orçamentos
  tinham 50x de folga a assimetria era teórica, porque ninguém precisava
  escolher. Apertá-los é justamente a condição em que a tentação de pagar com
  segurança aparece.

  A regra vale por três verificações e não por declaração: os números de
  performance vêm do build padrão com todo controle ativo; um controle que torne
  um orçamento inalcançável move o orçamento, com o número medido registrado
  junto; e código que baixa artefato de terceiro confere o digest antes de
  executar. No CI a precedência é literal — o job `perf` declara
  `needs: [supply-chain]`, então o resultado de performance não é sequer
  produzido enquanto a política de dependências não passa
  ([ADR-0011](docs/architecture/decisions/0011-seguranca-antes-de-performance.md)).

  Uma otimização legítima fica fechada por isso: adiar a resolução de credencial
  ou a detecção de confinamento para o primeiro uso da ferramenta é a economia
  mais óbvia contra um orçamento de startup, e FR-11 exige que a ausência de
  confinamento seja dita — dizer depois de o usuário já ter decidido agir não é
  dizer.

- **Cada métrica de performance ganhou um segundo piso, relativo a um
  concorrente nomeado.** O orçamento de startup era 100 ms e a medição, 0,6 ms:
  uma regressão de cinquenta vezes passava no gate. É palavra por palavra o
  defeito que o [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  já diagnosticou em cobertura — um piso muito abaixo do valor real deixa de ser
  piso e vira decoração —, e a resposta é o mesmo desenho: dois pisos, valendo o
  mais apertado.

  A diferença é que performance de harness só significa alguma coisa contra
  alguém. Ser mais rápido que a alternativa já instalada é a razão declarada de
  este projeto existir em Rust, e nenhum piso absoluto detecta o caso em que o
  concorrente melhora e nós não. O baseline é o `codex-cli`, escolhido porque é
  o único CLI de IA relevante reescrito em linguagem nativa e, ao mesmo tempo,
  uma das cinco referências permitidas — o mais rápido e o permitido são o mesmo
  projeto, então a escolha não custa nada em proveniência. Ele vive versionado
  em [`scripts/perf-baseline.txt`](scripts/perf-baseline.txt) com versão, data e
  digest, é medido por este repositório com o método do próprio gate, e é
  remedido pelo workflow agendado `perf-baseline.yml`, que abre PR quando o
  número se move. O CI de PR não fala com a rede
  ([ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)).

- **FR-20 — `--image` anexa uma imagem ao pedido.** O arquivo é lido e embutido
  em base64, nunca referenciado por URL: uma URL faria o gateway buscar o
  arquivo, o que muda quem alcança a rede e o que o operador consegue auditar —
  e uma imagem local não teria URL nenhuma. Os três dialetos recebem o formato
  nativo de cada um; no Chat Completions o conteúdo vira lista, e só quando há
  imagem, porque mudar a forma sem necessidade invalidaria o cache de prompt.

  O tipo vem dos bytes e não da extensão: um `.png` que na verdade é JPEG faz o
  backend recusar com uma mensagem que não diz por quê. Um `RIFF` que não é WebP
  — um WAV, um AVI — é barrado aqui em vez de três camadas adiante. Arquivo
  ilegível, formato desconhecido ou acima do teto de 5 MiB param antes do turno,
  porque descobrir isso depois teria custado uma ida ao gateway para nada.

### Alterado

- **O gate de performance compara o menor tempo observado, não a mediana.** Não
  é preferência de estimador: num runner compartilhado a mediana mede a
  contenção e o mínimo mede o programa. Repetindo a mesma amostragem numa
  máquina em load average 89, o mínimo da chegada do processo ficou entre 465 µs
  e 560 µs — dispersão de 1,2x — enquanto a mediana foi de 1.033 µs a 3.580 µs,
  dispersão de 3,5x. Com a mediana o gate reprovava um binário sem nenhuma
  regressão, que é o modo de falha mais caro que um gate tem: uma vez que ele
  falha por ruído, alguém o desliga.

  O baseline mudou junto, e tinha que mudar: comparar o nosso mínimo com a
  mediana do concorrente inflaria a razão a nosso favor. `startup_median_us`
  virou `startup_fastest_us` e passou de 13.090 µs para 3.446 µs — o menor de
  quatro amostragens, que é o número mais favorável ao concorrente e portanto o
  mais honesto para calcular a nossa barra. Com ele, a margem relativa de
  startup caiu de ÷5 para ÷3: no pior caso observado a razão é 6,2x, e ÷5
  deixaria 1,2x de folga contra os 2x de ÷3.

- **O digest do artefato do concorrente saiu do sentinela.**
  `artifact_sha256` valia `nao-fixado` e `source_url` apontava para a página de
  releases, o que travava o workflow agendado por desenho — não havia contra o
  que conferir. Agora aponta para o `.tar.gz` do
  `codex-x86_64-unknown-linux-musl` da release `rust-v0.147.0`, com o digest do
  arquivo como ele chega da rede.

  O `perf-baseline.yml` ganhou o passo de extração que faltava: ele conferia o
  digest e executava o arquivo baixado direto, o que funcionaria para um binário
  cru e falha para um tarball. A ordem agora é conferir, extrair, executar —
  desempacotar antes de conferir já seria rodar o desempacotador sobre bytes não
  verificados. O `codex-package_SHA256SUMS` publicado não serve de contraparte
  porque cobre só os archives `*-package-*` e não menciona o binário puro; não
  havendo contra o que conferir a não ser o que este repositório fixou, adotar
  versão nova é uma alteração de digest visível em diff de PR, que é o controle
  que o NFR-8 exige.

- **Os ADRs 0011 a 0017 foram renumerados.** Três arquivos reivindicavam o 0011
  e três o 0012, cada um sobre um assunto diferente, resultado de trabalhos
  paralelos que escolheram "o próximo número" ao mesmo tempo — um "ver ADR-0012"
  podia apontar para confinamento, para performance ou para cancelamento. O par
  segurança/performance ficou com 0011 e 0012 porque o 0013 já citava esse 0012
  e reapontá-lo custaria mais do que deslocar os outros; extensão e confinamento
  desceram para 0016 e 0017, com as citações corrigidas nos dois sentidos.

- **O gate de performance passou a medir a sessão montada.** Ele aferia NFR-1 e
  NFR-2 com `nycode --version`, que o `clap` resolve dentro de `Cli::parse()` e
  encerra antes do runtime, da credencial, do disco e do MCP — tudo que os dois
  requisitos descrevem ficava fora da amostra, e o comentário no topo do
  `main.rs` fechava o círculo justificando o atalho com o gate que media o
  atalho. A rota `--probe-startup [MS]` monta a sessão de verdade, segura-a
  parada pelo tempo pedido e sai sem gastar um turno; o intervalo é parâmetro
  porque a latência quer sair na hora e o pico de memória quer esperar o
  runtime e as conexões MCP assentarem.

  Os números que isso revela: 2.901 µs para montar a sessão contra 589 µs de
  `--version`, e 8.364 KB de RSS ocioso contra 5.096 KB. O segundo já passava do
  piso absoluto de 8.192 KB que o [ADR-0012](docs/architecture/decisions/0012-performance-e-medida-contra-um-concorrente-nomeado.md)
  fixara — não por regressão, mas por o piso ter sido calibrado sobre uma carga
  que nunca aloca a sessão. A carga nova ganhou pisos próprios, 15.000 µs e
  14.336 KB, e o `--version` continua medido como chegada do processo por ser a
  única métrica com par comparável no concorrente
  ([ADR-0013](docs/architecture/decisions/0013-o-gate-mede-a-sessao-montada-e-nao-o-version.md)).

- **O gate de performance ganhou bateria própria.** `perf-gate-test.sh` monta
  repositórios sintéticos e exige o código de saída de cada caso — 0 aprova, 1 é
  violação de piso, 2 é erro de uso — como `coverage-gate-test.sh` já fazia. O
  volante é o baseline: como vale o piso mais apertado entre o absoluto e o
  relativo, um baseline minúsculo aperta o relativo e reprova qualquer medição,
  o que exercita cada piso sem depender de a máquina estar ociosa. A bateria já
  se pagou: encontrou o gate transformando "o binário não monta sessão" numa
  falha de instrumento, saindo 2 onde devia sair 1.

- **`observer.rs` e `events.rs` viraram `output/`.** São os dois destinos do que
  um turno produz e mudam juntos: acrescentar um evento ao contrato JSON exige
  decidir o que o texto mostra no lugar dele.

- **`nycode-mcp/session.rs` foi repartido.** Estabelecer a conexão e conversar
  sobre ela mudam por motivos diferentes — ali o que varia é transporte,
  arranque e degradação por servidor; aqui é o formato do resultado de uma
  chamada. `connect`, `attach` e `connect_all` desceram para `session/connect.rs`
  quando os prazos novos levaram o arquivo ao teto de 500 linhas.

- **`main.rs` foi repartido.** Ele estava no teto de 500 linhas e o `src/` no de
  8 arquivos, então a flag nova não cabia sem reagrupar. Saíram o vocabulário de
  códigos de saída (`exit.rs`), que muda quando o `stop_reason` do gateway muda,
  e a escolha de superfície (`route.rs`), que é função pura dos argumentos e do
  ambiente. O `catalog.rs` desceu para `session/`, onde é o único a usá-lo, e a
  exibição de caminhos virou `session/paths.rs`.

- **FR-19 — `/model` troca de modelo sem derrubar a conversa.** Sem argumento
  lista o que o endpoint serve, porque o usuário não tem como adivinhar o
  identificador aceito; com argumento troca, recusando antes um id que o
  catálogo não conhece — aceitar só falharia no próximo turno, quando o gateway
  recusasse, longe da causa. Sem catálogo obtido nada é recusado, porque
  transformar a indisponibilidade em erro de uso seria pior.

  O histórico fica: continuar a mesma conversa com outro modelo é o ponto —
  recomeçar já dava para fazer abrindo outra sessão. A fábrica de backend fecha
  sobre a configuração já resolvida, então trocar de modelo não significa
  reautenticar.

### Corrigido

- **Responder numa sessão gravada antes dos identificadores apagava a conversa
  da leitura.** Um arquivo v1 não tem `id` em registro nenhum, então `tip` não
  achava ponta, o `append` gravava a mensagem nova como **raiz**, e a leitura
  passava a seguir a árvore a partir dela — o índice de `id` não enxerga
  registro v1, e a caminhada terminava na primeira parada. `--resume` numa
  sessão antiga devolvia só a última mensagem, e o modelo recebia uma conversa
  sem passado.

  O que torna isto caro é que nada se perdia no disco: o arquivo continua
  append-only e íntegro, com todas as mensagens lá. A perda existia só na
  leitura, que é onde ninguém procura. A correção é o prefixo — a corrida de
  registros sem `id` que abre o arquivo entra na frente do caminho reconstruído.

  O teste que cobria compatibilidade v1 só **lia** um arquivo v1 e nunca
  acrescentava a um, que é justamente o caso de uso da compatibilidade.

  A reconstrução da conversa saiu de `store.rs` para `store/tree.rs`: é lógica
  pura sobre registros já carregados, os testes dela já viviam em arquivo
  separado, e o `store` fica com o I/O.

- **O total de tokens publicado omitia `reasoning_tokens`.** A soma do usage era
  uma lista de atribuições escrita à mão, e ela cobria cinco dos seis campos de
  `Usage`. O campo não é morto — os dois decodificadores OpenAI o preenchem e
  têm teste para isso —, então o modo `--output-format json` publicava
  `"reasoning_tokens": 0` para um turno em que o gateway tinha medido outro
  número, e o rodapé da sessão interativa contava a mesma coisa.

  A soma passou a viver junto do tipo, como `AddAssign` em `Usage`, e
  desestrutura o valor recebido: um campo novo em `Usage` não compila até que
  alguém decida ali como ele soma. A alternativa seria outra lista à mão, com o
  mesmo modo de falha esperando o próximo campo.

- **Um turno que nunca disse como terminou era reportado como concluído.** O
  laço do agente fechava a lacuna com `unwrap_or(StopReason::EndTurn)`, o que
  contradizia por escrito o módulo logo abaixo: `event.rs` abre dizendo que a
  projeção preserva o que o gateway emitiu e nunca inventa um `EndTurn`, e tem
  teste para isso. A garantia era desfeita uma camada acima, onde nada olhava.

  A consequência era observável: `exit::code_for` mapeia `EndTurn` para
  `ExitCode::SUCCESS`, então um turno cujo motivo de parada nunca chegou saía
  com código 0, indistinguível de uma resposta completa para o script que
  encadeia `nycode`. Agora vira `Unrecognized("ausente")`, que já cai no código
  de saída reservado e sobrevive intacto até o stream de eventos JSON.

- **O dialeto `openai-completions` não executava ferramenta nenhuma.** O chunk
  de `finish_reason` precisa fechar as chamadas que ficaram abertas *e* encerrar
  a mensagem, mas `StreamDecoder::decode` devolve um evento por linha do wire: o
  `return` que emitia o `ToolCallEnd` engolia o `MessageEnd`, e não existe uma
  segunda linha com `finish_reason` para recuperá-lo — o chunk de usage vem com
  `choices` vazio. O turno chegava ao agente sem `stop_reason`,
  `Turn::wants_tools` respondia `false`, e o laço devolvia `Outcome` descartando
  as chamadas que o modelo tinha pedido. Com chamadas paralelas o dano dobrava:
  um único `pop()` fechava uma e as outras nunca saíam de `open_tools`.

  O mesmo caminho perdia mais duas coisas em silêncio. O array `tool_calls` era
  lido só na primeira posição, então a segunda chamada de um chunk paralelo
  sumia antes de ser anunciada; e o fragmento de abertura era tratado como "ou
  id e nome, ou argumentos", quando o backend manda os três juntos — o começo do
  JSON era descartado e o modelo recebia de volta um erro de parse que não tinha
  causado.

  A correção é uma só para os quatro defeitos: o decodificador ganhou fila, e o
  `trailing()` que existia para o usage do `responses` virou um `drain()` que o
  driver esvazia antes de puxar cada linha e de novo no encerramento. Um dialeto
  que empacota vários eventos numa linha passa a caber no contrato, em vez de
  ter que escolher qual deles perder.

  Nenhum teste pegava, e o que existia congelava o defeito:
  `assembles_a_tool_call_from_indexed_fragments` afirmava o `ToolCallEnd` e nunca
  que um `MessageEnd` tinha sido emitido, e `Kind::OpenAiChat` só aparecia em
  teste de nome de dialeto e de header — nada dirigia o dialeto através do
  agente. Cada uma das linhas defeituosas estava coberta.

- **O primeiro `Ctrl+C` transformava a sessão interativa num no-op silencioso.**
  `Cancel` era um latch de mão única, e a sessão compartilhava um único sinal
  com o agente por todos os turnos. Depois da primeira interrupção, cada pedido
  seguinte era empilhado no histórico, curto-circuitado antes de chegar ao
  gateway, mapeado para sucesso e gravado no arquivo de sessão — sem resposta,
  sem erro, e deixando no disco mensagens nunca respondidas que voltavam no
  `--continue`. O sinal passa a ser rearmado no topo de cada turno, porque
  cancelar é do turno e não da sessão
  ([ADR-0015](docs/architecture/decisions/0015-o-cancelamento-e-por-turno.md)).
  Nenhum teste pegava: todos os de cancelamento rodavam `run()` uma vez só.

- **Não havia prazo de rede nenhum, em lugar nenhum.** O cliente configurava
  `user_agent` e mais nada, então um gateway que aceitasse a conexão e parasse
  de emitir pendurava o turno para sempre — e a única saída era o `Ctrl+C` que o
  defeito acima inutilizava. A busca de catálogo, que roda no arranque antes de
  a interface abrir, travava o binário sem desenhar nada na tela.

  Os prazos são de ociosidade e não de duração, porque um turno com raciocínio
  estendido leva minutos e o teto que protege contra um gateway morto seria o
  mesmo que mataria a resposta longa: `connect_timeout` de 10s e `read_timeout`
  de 120s, que reinicia a cada chunk e portanto mede o intervalo entre eventos
  do SSE. Só o catálogo, que não é streaming, ganha prazo total
  ([ADR-0014](docs/architecture/decisions/0014-prazos-de-rede-do-cliente-de-wire.md)).
  O mesmo ADR registra a política de retentativa, que existia em código sem
  decisão registrada. Ociosidade no meio do stream virou `Error::StreamIdle`, e
  não `MalformedStream` — o corpo não veio quebrado, e dizer que veio mandaria o
  usuário depurar a coisa errada.

- **O `bash` afirmava ter interrompido um comando que seguia rodando.** O
  estouro de prazo apenas largava o future, e o `Child` do tokio desanexa o
  processo no drop em vez de matá-lo: a ferramenta respondia "excedeu 90s e foi
  interrompido" enquanto o comando continuava escrevendo no workspace que o
  modelo estava inspecionando. É o NFR-4 pelo avesso — afirmar uma ação que não
  aconteceu. O comando passa a ser marcado com `kill_on_drop`, o que cobre os
  dois caminhos que largam o future, o prazo e o cancelamento no despacho; o
  argv do `bubblewrap` ganhou `--unshare-pid`, de modo que terminar o comando
  leve junto o que ele iniciou; e onde não há confinamento a mensagem passa a
  dizer que netos podem sobreviver, em vez de prometer o que não cumpre.

- **O hook tinha o mesmo defeito do `bash`, e mais um.** O prazo de 5s largava o
  future sem matar o processo, e um hook dispara a cada chamada de ferramenta —
  o que fica para trás se acumula ao longo da sessão, ainda escrevendo no
  workspace. Ganhou `kill_on_drop`. O que não tinha par no `bash` é que o stdout
  do hook não tinha teto nenhum: o prazo limita tempo, não memória, e em cinco
  segundos um hook escreve muito mais do que cabe no orçamento do NFR-2. Agora
  são 64 KiB guardados, e o excedente é lido e descartado em vez de deixar de
  ser lido — parar de ler encheria o pipe e travaria o hook, que é o oposto de
  falhar aberto.

- **Um padrão de `find` podia pendurar a busca para sempre.** O glob casava `*`
  por retrocesso recursivo, sem memoização, e o padrão vem do modelo: um
  `*a*a*a*a*b` contra um nome longo é retrocesso catastrófico, chamado duas
  vezes por arquivo, e nenhuma ferramenta tem prazo de execução. Virou varredura
  de dois ponteiros que volta ao último `*` e o faz engolir mais um byte — O(n·m)
  e sem pilha.

  No mesmo caminho, dois tetos que não seguravam nada. `MAX_VISITED` só era
  conferido no topo do laço externo, e um diretório plano é uma iteração só do
  externo: cinco milhões de arquivos passavam direto. E tanto a varredura quanto
  o `ls` coletavam o diretório inteiro num `Vec` para só depois descartar o
  excedente, o que já havia custado a memória que o teto existe para poupar.
  Ambos passaram a guardar as `cap` menores entradas, que é o mesmo prefixo que
  a ordem estável já entregava.

- **Todo teto de tamanho de arquivo era conferido depois da carga.** `read`
  truncava em 256 KiB depois de `tokio::fs::read` no arquivo inteiro; `edit` não
  tinha teto e ainda fazia uma cópia completa na substituição; `--image` e os
  arquivos de instrução repetiam o padrão. O teto limitava o que chega ao modelo
  e nada limitava o que entra na memória, num processo cujo orçamento de RSS é
  30 MiB — um arquivo grande no workspace derrubava o agente antes de o corte
  acontecer. O módulo `capped` passou a ler com teto e a tirar o tamanho real do
  metadado, que é o que as mensagens de truncamento mostram. `edit` ganhou teto
  explícito de 2 MiB, com recusa nomeada em vez de estouro no meio da edição.

  Um efeito colateral do corte por byte: ele pode partir um codepoint. Isso é
  diferente de um binário — ali o inválido está só nos últimos bytes —, e
  confundir os dois faria `read` recusar como binário um texto acentuado
  perfeitamente legível.

- **Gravar a sessão custava O(N²).** A escrita era append-only, mas descobrir o
  pai relia e reparseava o arquivo inteiro a cada mensagem, e o append acontece
  por mensagem e não por turno: um turno com vinte ferramentas fazia vinte
  leituras completas. `load` lia duas vezes, uma para achar a ponta e outra para
  montar o caminho até ela. O `Store` passou a lembrar a ponta que ele mesmo
  gravou — ele é quem grava, então não precisa reler para redescobri-la —, e
  `load` reaproveita os registros que já tem em mãos.

- **Nenhuma operação MCP tinha prazo.** Nem o handshake, nem a listagem de
  ferramentas, nem a chamada. Um servidor que sobe e emudece pendurava a
  abertura da sessão antes de a interface desenhar qualquer coisa, e uma
  ferramenta travada pendurava o turno; o `Ctrl+C` salva quem está no terminal,
  e em headless não há quem o aperte. São 20s para o arranque e 120s para uma
  chamada, que pode ser legitimamente demorada. O silêncio virou `Error::Timeout`
  e não `Connect`, porque o remédio é outro: recusa é configuração errada,
  silêncio é servidor travado.

- **A bateria de testes sujava o próprio repositório.** O helper que roda o
  binário nos testes de ponta a ponta não fixava diretório de trabalho, e o
  corrente de um teste de integração é a raiz do pacote: cada execução deixava
  sessões e cache de catálogo em `crates/nycode-cli/.nycode/`, um diretório não
  ignorado que entraria no primeiro commit. O helper passa a rodar num
  temporário, e sessão e cache de catálogo entraram no `.gitignore` — hooks,
  skills e regras em `.nycode/` continuam versionáveis, que é o ponto deles.

- **No dialeto `openai-responses` a contagem de tokens se perdia inteira.** O
  decodificador absorvia o usage e aceitava a marca de heurística, mas nunca
  emitia o evento: `decode` devolve um evento por linha do wire, e o
  `response.completed` — que concentra `stop_reason` e usage — já gastava esse
  retorno com o fim do turno. O resultado era contagem zerada, taxa de cache
  sempre em zero contra o NFR-7, e a flag de usage estimado que o NFR-4 exige
  visível nunca chegando ao usuário. O decodificador ganhou como emitir um
  evento que só cabe depois do encerramento, drenado pelo laço do stream.

- **Um arquivo ausente do relatório de cobertura passava pelo gate como se
  tivesse sido aprovado.** Os dois pisos do
  [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  iteravam sobre o que o relatório continha, então o que não estava lá não era
  reprovado: não era examinado. A demonstração foi acidental — o gate imprimiu
  97,95% e "ambos os pisos satisfeitos" com `context/commands.rs`, 369 linhas
  recém-escritas, nunca medida, porque o relatório era três minutos mais velho
  que o arquivo. Bastou editar código depois de medir, que é a ordem natural de
  quem roda a bateria local.

  O gate passou a recusar relatório mais velho que qualquer fonte e a exigir que
  todo arquivo de produção em disco apareça no relatório ou esteja declarado
  como `no-statements`
  ([ADR-0010](docs/architecture/decisions/0010-o-gate-de-cobertura-exige-relatorio-completo-e-fresco.md)).
  A tabela de exemptions ganhou treze declarações — glue de módulo e um tipo de
  erro cujo único código executável é derivado, que o instrumentador do rustc
  não marca — e continua sem nenhum `below-floor`, que é a entrada que dispensa
  código medido de alcançar o piso.

  O próprio gate deixou de ser código sem teste: `scripts/coverage-gate-test.sh`
  monta repositórios sintéticos e exige o código de saída em quinze casos. Um
  gate que perdeu a capacidade de falhar aprova o workspace inteiro em silêncio,
  e nada avisaria.

- **`is_production` tratava `tree_tests.rs` como código de produção.** O filtro
  reconhecia `*_test.rs` mas não `*_tests.rs`, então 220 linhas de
  `#[cfg(test)] mod` entravam na conta que deveria medir só o que elas protegem.

- **Uma tecla digitada no instante em que o turno terminava virava
  direcionamento do turno seguinte.** O `select!` do laço escolhia ao acaso
  entre ramos prontos, então uma linha submetida no momento exato do fim do
  turno podia ser lida como correção de rumo em vez do pedido que o usuário
  digitou. O laço passou a ser enviesado: se o turno terminou, ele fecha antes
  de ler mais eventos.

- **FR-17 — plan mode, com `/plan`.** Entrar troca o gate por somente-leitura e
  acrescenta ao sistema a explicação de por quê: sem ela o modelo tentaria
  escrever, receberia recusa, e gastaria rodadas descobrindo o que já era para
  saber. O gate é a contenção de verdade; a instrução só evita o desperdício.

  Trocar o gate e o sistema no meio da sessão foi o que isto exigiu do agente.
  Refazer a sessão para mudar de modo perderia o contexto que é justamente o
  insumo do plano. Sair devolve o gate que a sessão tinha e não um padrão: com
  `--allow-writes` ele permitia tudo, e voltar a perguntar seria mudar a sessão
  pelas costas do usuário.

- **FR-15 — a ferramenta `task`, que delega a um subagente.** Existe pela janela
  de contexto: uma busca que lê trinta arquivos para achar três linhas gasta a
  janela inteira do pai com o que ele não vai precisar de novo; delegada, ela
  devolve as três linhas e o resto morre com o filho.

  O filho não vê o histórico do pai — herdá-lo desfaria a razão de existir da
  ferramenta, porque o custo seria o mesmo. Ele herda a permissão, porque um
  subagente que pudesse mais que quem o chamou seria uma escada de privilégio. E
  não recebe a própria `task` no catálogo: a recursão é impedida pela
  construção, e não por um contador que dependeria de o modelo respeitá-lo. Um
  filho que termina sem produzir texto chega ao pai marcado como erro, não como
  sucesso vazio.

  É divergência deliberada da referência
  ([ADR-0007](docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)):
  o `pi` recusa subagentes e recomenda `tmux`. A recusa dele é sobre agentes
  concorrentes de longa duração; isto é uma chamada síncrona que devolve texto e
  acaba.

### Alterado

- **`grep`, `find` e `ls` passaram a viver em `tools/search/`.** Compartilham a
  varredura e mudam juntas: o que uma delas passa a ignorar, as outras precisam
  ignorar também, senão `find` oferece um caminho que `grep` nunca vai visitar.

- **FR-16 — hooks de ciclo de vida.** O terceiro mecanismo de extensão do
  ADR-0002 passou a existir: executáveis em `.nycode/hooks/` ou
  `.claude/hooks/`, um por evento, com contrato JSON em stdin e stdout
  ([ADR-0009](docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)).
  `pre-tool-use` pode vetar, e a razão que ele devolve chega ao modelo como
  resultado corrigível — sem ela, ele só saberia que falhou e tentaria de novo
  do mesmo jeito.

  O hook é consultado antes do gate: uma política que só rodasse depois não
  conseguiria proibir nada que o gate permitisse. Falha aberto, de propósito —
  um hook que trava, quebra ou responde lixo não bloqueia a sessão, porque a
  alternativa transformaria um script quebrado num agente inutilizável. Quem
  quer bloqueio garantido usa o gate, que é código. Um arquivo sem bit de
  execução é rascunho e não hook: executá-lo produziria um erro a cada chamada.

### Corrigido

- **Um hook recém-instalado podia ser pulado em silêncio.** `execve` devolve
  `ETXTBSY` enquanto alguém ainda tem o executável aberto para escrita — um
  instalador, ou o editor do usuário salvando. Desistir na primeira tentativa
  pularia um hook que existe e está instalado, que é o pior desfecho possível
  para uma camada de política. Agora há uma segunda tentativa depois de 50ms.
  O sintoma apareceu como teste intermitente, uma falha a cada quatro execuções.

- **FR-18 — dá para falar com um turno em andamento.** Digitar durante um turno
  descartava o que foi escrito, sem dizer nada, e corrigir o rumo exigia
  cancelar e recomeçar — jogando fora o que as ferramentas já tinham feito. O
  que o usuário completa com Enter entra na fila e chega ao modelo na próxima
  rodada, com aviso do que foi acrescentado: uma mensagem que entra em silêncio
  faz o modelo mudar de rumo sem que o usuário saiba por quê.

  A injeção acontece entre rodadas e em nenhum outro lugar. Ali o histórico está
  fechado, com todo `tool_use` já pareado; injetar no meio quebraria o par e o
  backend recusaria a conversa inteira — há um teste que percorre o histórico
  inteiro verificando isso. A fila tem quatro lugares e diz quando enche:
  acumular dez correções para despejar de uma vez confundiria mais que ajudaria,
  e perder uma em silêncio faria o usuário achar que corrigiu o rumo.

- **FR-14 — a sessão virou uma árvore.** O formato de registro subiu para a v2 e
  cada linha ganhou `id` e `parent_id`
  ([ADR-0006](docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md)).
  `/tree` lista os pontos de retomada e `/fork <n>` passa a gravar a partir de
  um deles — nada é reescrito, o arquivo continua append-only, e a ramificação
  existe porque dois registros passam a compartilhar o mesmo pai. O ramo
  abandonado continua legível pela própria ponta.

  Ler devolve o caminho até o último registro gravado, e não o arquivo inteiro:
  mandar ramos abandonados ao modelo os apresentaria como parte da conversa. Um
  arquivo v1 continua legível — sem `id`, a sessão é uma lista, que é a árvore
  em que ninguém ramificou. Um `parent_id` órfão ou em ciclo termina a leitura
  em vez de pendurar o processo.

  Só turnos do usuário são oferecidos como ponto de retomada: ramificar do meio
  de uma resposta deixaria um `tool_use` sem o `tool_result` par, e o backend
  recusa a conversa.
- **Comandos embutidos de sessão.** `/help`, `/tree`, `/fork`, `/compact`,
  `/export` e `/quit` agem sobre a própria sessão e nunca gastam um turno.
  Resolvidos antes dos comandos de arquivo: um `/tree.md` no repositório não
  pode sequestrar a navegação da sessão.

- **A sessão interativa pergunta antes de mutar.** A permissão era binária:
  somente-leitura, ou `--allow-writes` liberando tudo de antemão. Onde há a quem
  perguntar, isso obrigava a escolher entre sessão inútil e cheque em branco.
  O gate ganhou uma terceira decisão, `Ask`, e a pergunta mostra a ferramenta e
  os argumentos — "permitir `bash`?" não é decidível; o que importa é qual
  comando.

  Quem pergunta é o loop de agente e quem sabe perguntar é o laço de interface,
  e os dois correm ao mesmo tempo: um canal os une sem inverter a posse. Toda
  ambiguidade resolve para não — teclado fechado, interrupção, tecla sem
  significado, interface caída. Em modo headless não há a quem perguntar e o
  padrão continua negando, porque aprovar por omissão daria a um pipeline a
  permissão que ninguém concedeu. Uma recusa volta ao modelo como resultado
  corrigível, não como aborto: ele pode propor outro caminho em vez de o turno
  inteiro se perder.

- **NFR-7 — o cache de prompt passou a ser pedido.** O `Usage` já reportava
  `cache_read_tokens` e `cache_write_tokens`, e o corpo enviado nunca carregava
  `cache_control`: a métrica existia sem a causa, e media zero para sempre.
  Agora o prefixo estável — o prompt de sistema e as ferramentas — leva um ponto
  de corte, e o rodapé mostra a taxa de acerto. Só a última ferramenta é
  marcada: o ponto de corte cobre tudo que veio antes dele, e um por ferramenta
  gastaria os que o backend limita.

  Com o marcador, `system` vai como lista de blocos em vez de string — é a forma
  que o dialeto exige, e sem cache a string volta. Um teste amarra a condição
  que faz o cache valer: o prefixo é byte-idêntico entre turnos, porque um
  prefixo que muda é um cache que erra e o custo volta inteiro sem que nada
  indique isso.
- **`temperature`, `top_p`, `stop_sequences` e `thinking` no corpo do pedido.**
  Nenhum vai ao wire sem ser pedido: mandar um valor inventado seria escolher
  por um modelo cujo padrão o provedor calibrou.

- **FR-13 — slash commands.** Um arquivo `nome.md` em `.nycode/commands/` ou
  `.claude/commands/` vira `/nome`, com `$ARGUMENTS` e posicionais `$1` a `$9`.
  Um pedido repetido — revisar um diff, escrever um commit, rodar a bateria —
  deixa de ser algo que o usuário redigita e vira algo que o repositório
  versiona, no mesmo formato que os outros harnesses já usam.

  A expansão acontece no cliente e o resultado vira um prompt comum: o modelo
  não sabe que existiu um comando, o que mantém o vocabulário de wire intacto.
  Um comando desconhecido não gasta turno — lista os que existem, porque mandar
  `/revisr` ao modelo custaria uma ida ao gateway para descobrir um erro de
  digitação. `/usr/bin/env` num pedido continua sendo caminho, não invocação.

- **FR-11 — o shell roda confinado pelo sistema operacional.** Até agora a única
  contenção de `bash` era o timeout e o stdin fechado: o gate de permissão
  decidia *se* o comando rodava, e nada decidia *o que ele alcançava* depois de
  começar. Isso fazia de `--allow-writes` um cheque em branco, com a política do
  harness virando convenção que qualquer `cd ..` contorna.

  A política é a forma do `workspace-write` do Codex — leitura ampla, escrita
  restrita à raiz e ao diretório temporário, rede negada — aplicada por
  `bubblewrap` no Linux e por `sandbox-exec` no macOS
  ([ADR-0005](docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)).
  Envolver o processo filho num executável do sistema é o que permite fazer isso
  sob `unsafe_code = "forbid"`, que elimina FFI para `sandbox_init` e
  `landlock_*`.

  Onde o confinamento não está disponível, o comando ainda roda e o usuário é
  avisado: a diferença entre "protegido" e "achou que estava protegido" é a
  única que importa aqui. `permission` e `sandbox` passaram a viver juntos em
  `policy`, porque só valem juntos.

- **As ferramentas `grep`, `find` e `ls` (FR-3).** O gate de permissão já as
  nomeava no conjunto somente-leitura e nenhuma existia, o que significa que uma
  sessão restringida ficava com uma única ferramenta. Agora negar `bash` deixa o
  agente restrito, não cego, e a escolha deixa de ser entre dar shell ou não ter
  agente. Um teste amarra os dois lados: tudo que o conjunto somente-leitura
  oferece passa pelo gate, e nada que muta passa.

  As três compartilham a varredura, que não sai da raiz, não segue link
  simbólico e não despeja `target/` nem `.git/` no contexto. Toda saída é
  ordenada e limitada — ordem instável invalidaria o cache de prompt do backend,
  e um padrão que casa com tudo produziria resposta maior que a janela. Um
  arquivo binário é pulado em vez de despejado, e nenhuma delas responde vazio
  quando não há resultado: "nenhuma linha casa" é informação, silêncio faz o
  modelo desconfiar da ferramenta.

- **FR-12 — modo de eventos JSON.** `--output-format json` publica um evento por
  linha em stdout: texto, raciocínio, início e fim de cada ferramenta, avisos de
  sessão, e um evento final com `stop_reason`, contabilidade de tokens e número
  de rodadas. Quem integra o binário deixa de ter de inferir isso de texto
  formatado para humano. Um turno que falha termina em `error` e não em
  `result`, para que um consumidor não trate falha como conclusão, e um
  `stop_reason` fora do vocabulário chega literal.
- **Paridade no CI (NFR-4, NFR-6).** `nycode-parity` ganhou binário e job. As
  duas dimensões que ficavam fixadas em vazio dos dois lados — sequência de
  ferramentas e contabilidade de tokens — passaram a ser lidas do modo de
  eventos de cada harness e traduzidas do dialeto de cada um: o formato divergir
  não é o defeito que o NFR-6 quer pegar, o contrato observável divergir é. As
  cinco dimensões são comparadas de fato.

  A comparação completa exige um gateway e o harness de referência; quando não
  estão configurados, [`scripts/parity-gate.sh`](scripts/parity-gate.sh) diz
  isso em voz alta em vez de passar em silêncio. O que continua travado nesse
  caso é que o próprio harness ainda detecta divergência, provado por testes que
  o alimentam com dois harnesses que deixam o disco, o código de saída e a
  sequência de ferramentas diferentes. O crate declarava recusar o antipadrão do
  harness que não pode falhar; agora há o que sustente a declaração.

- **Compactação sob pressão real.** `ApiError::is_context_overflow` reconhecia
  as duas formas de estouro e `compact` sabia cortar sem separar um `tool_use`
  do resultado dele, e nada ligava os dois. Agora um estouro de janela compacta
  o histórico e repete o turno em vez de abortar a tarefa no meio. O gatilho é o
  erro do gateway e não um palpite sobre tamanho; a tarefa original sobrevive ao
  corte, porque perdê-la faria o agente esquecer o que estava fazendo. Um
  histórico já no mínimo devolve o erro ao usuário em vez de tentar de novo, e o
  teto de duas compactações por pedido garante que um gateway respondendo
  estouro a tudo não faça o agente compactar até esquecer a tarefa.

  O `Observer` ganhou `on_notice`, e o aviso aparece mesmo em modo silencioso:
  compactar muda o que o modelo lembra, e sem o aviso o usuário fica sem
  explicação para um esquecimento.

- **FR-6 — o catálogo de modelos passou a ser consultado.** `catalog::fetch`
  existia, era testado e nunca era chamado; agora o `GET /v1/models` do próprio
  endpoint decide o que é um modelo válido. Um nome que o endpoint não serve é
  recusado antes de gastar um turno, com a lista do que existe — quase sempre é
  erro de digitação, e a alternativa era uma recusa do gateway três camadas
  adiante.

  O resultado fica em `.nycode/catalog.json` por seis horas, chaveado pela URL
  base: consultar a cada execução poria uma ida à rede no caminho de startup que
  o NFR-1 mede, e servir o catálogo de um gateway para outro faria o usuário
  escolher um modelo que o endpoint atual não tem. A validação só acontece
  contra um catálogo efetivamente obtido — recusar com base num cache vencido ou
  num gateway fora do ar transformaria indisponibilidade em erro de uso, e a
  indisponibilidade é dita em `stderr` em vez de passar em silêncio.

- **MCP fala o protocolo de verdade (FR-7, primeiro mecanismo).** O crate novo
  `nycode-mcp` implementa o trait `Transport` que o agente já esperava, sobre o
  SDK oficial `rmcp`
  ([ADR-0004](docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)),
  com transporte stdio por processo filho e Streamable HTTP. A descoberta de
  `.mcp.json` — que existia, era testada e nunca era chamada — passou a rodar no
  startup, e as ferramentas dos servidores entram no catálogo com nome
  qualificado. `ServerConfig` ganhou `url` ao lado de `command`, mantendo o
  formato que os outros harnesses já gravam.

  Um servidor que não sobe vira aviso em `stderr` e a sessão segue: a
  alternativa transformaria toda extensão opcional em dependência obrigatória.
  Um resultado que o servidor marca como erro chega ao modelo marcado como erro,
  e uma resposta sem bloco de texto cai para o conteúdo estruturado em vez de
  virar resposta vazia.

  O protocolo é exercitado de verdade nos testes, contra um servidor MCP em
  processo ligado por canais em memória — handshake, `tools/list`, `tools/call`,
  recusa do servidor e erro de protocolo. Depender de ter um servidor instalado
  na máquina teria deixado justamente essa camada sem teste.

- **FR-1 — sessão interativa.** `nycode` num repositório agora abre uma sessão
  em vez de sair com código 2. O crate `nycode-tui`, que existia pronto e sem
  nenhum arquivo `.rs` que o referenciasse, ganhou o que faltava para ser usável:
  editor multilinha com histórico navegável e rascunho preservado, tradução de
  teclas isolada em `keys`, layout que conta células e não caracteres — um
  ideograma ocupa duas colunas —, e cabeçalho e rodapé em `panel`. O rodapé
  mostra tokens, taxa de acerto de cache e custo acumulado, e marca contagem
  estimada como estimada. O `Outcome` do agente passou a carregar o usage somado
  de todos os turnos do pedido, porque reportar só o último esconderia a maior
  parte da conta justamente nos pedidos com ferramenta.

  O modelo é o do scrollback e não o de tela alternativa
  ([ADR-0008](docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)):
  rolagem, busca e cópia continuam sendo do emulador. Todo desenho vai em saída
  sincronizada, sem a qual o redesenho diferencial troca flicker de quadro
  inteiro por flicker de linha.

  Pedir sessão interativa sem terminal — `echo x | nycode` — é recusado com
  código 2 em vez de pendurar num prompt que ninguém pode responder.

  O laço não conhece o terminal: superfície e agente entram por trait, e a
  ligação com o TTY vive em `screen`. Foi o que permitiu cobrir a sessão inteira
  sem TTY e sem rede, e manter a tabela de exemptions vazia — a resposta que o
  [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md)
  exige quando um arquivo não alcança o piso é abrir costura, não dispensar o
  arquivo.

- **FR-4 — cancelamento de verdade.** `Ctrl+C` interrompe o turno em vez de
  matar o processo, e a sessão guarda o que já aconteceu. O trabalho difícil não
  era parar o stream, que é um drop: era fechar o que o turno abriu. O backend
  rejeita uma conversa em que um bloco `tool_use` não tem `tool_result`, então
  cancelar no meio de uma rodada precisa responder por toda chamada que não
  rodou — e o motivo chega ao modelo marcado como falha, porque "não executou" é
  diferente de "executou e não devolveu nada". Estourar o teto de iterações
  deixava a mesma pendência e passou a fechar do mesmo jeito. Um turno cancelado
  sai com 130, a convenção de shell para `SIGINT`; uma falha de wire continua
  não gravando nada, porque aconteceu antes de qualquer efeito no disco.

- **Emenda de escopo na [spec](.specs/nycode-rs/spec.md): FR-11 a FR-20 e
  NFR-7.** Confinamento do shell pelo sistema operacional, três modos de saída,
  slash commands, sessão em árvore, subagentes, hooks, plan mode, enfileiramento
  e direcionamento de mensagem, troca de modelo mid-session e entrada de imagem;
  mais estabilidade de prefixo para que o cache de prompt acerte. FR-3 passou a
  incluir o conjunto somente-leitura de busca e listagem, que o gate de permissão
  já nomeava sem que existisse.
- **RECON que fundamenta a emenda**, em
  [`research-sota-2026.md`](.specs/nycode-rs/research-sota-2026.md), com o
  material bruto em [`sources/`](sources/README.md).
- **Seis ADRs**: [0004](docs/architecture/decisions/0004-cliente-mcp-usa-o-sdk-oficial-rmcp.md)
  cliente MCP pelo SDK oficial `rmcp`;
  [0005](docs/architecture/decisions/0005-sandbox-de-so-por-processo-auxiliar.md)
  confinamento aplicado ao processo filho, sob a restrição de `unsafe_code =
  "forbid"`; [0006](docs/architecture/decisions/0006-a-sessao-e-uma-arvore-no-mesmo-arquivo.md)
  sessão em árvore preservando o append-only;
  [0007](docs/architecture/decisions/0007-subagentes-sao-in-process-divergindo-da-referencia.md)
  subagentes in-process, divergência registrada da referência;
  [0008](docs/architecture/decisions/0008-a-tui-usa-o-renderizador-proprio-sobre-o-scrollback.md)
  TUI sobre o scrollback, sem alt-screen;
  [0009](docs/architecture/decisions/0009-hooks-sao-executaveis-com-contrato-json.md)
  hooks como executáveis com contrato JSON e direito de veto.

- Baseline de documentação guiada por spec: [`docs/INDEX.md`](docs/INDEX.md),
  [`PRD.md`](PRD.md), [`ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md),
  [`REQUIREMENTS.md`](docs/requirements/REQUIREMENTS.md),
  [`ROADMAP.md`](docs/product/ROADMAP.md), índice e modelo de ADR, e modelo de spec.
- `AGENTS.md` na raiz, tornando as regras do repositório vinculantes para
  contribuidores agentes — e dogfooding do FR-8, que diz que o `nycode` lê esse
  arquivo.
- [ADR-0003](docs/architecture/decisions/0003-pisos-de-cobertura-95-agregado-90-por-arquivo.md):
  pisos de cobertura de 95% agregado e 90% por arquivo de produção.
- Cobertura das superfícies que antes não tinham teste: `impl Observer` e
  `finish` em `nycode-cli`, `impl Debug`, `with_message` e o roteamento de
  reasoning delta em `nycode-agent`, e `resolve_session` em `nycode-cli`.

### Alterado

- **Três buracos que abriam em silêncio nos gates foram fechados.** O NFR-2
  passava quando `/usr/bin/time` faltava — que é pacote separado no Debian e no
  Ubuntu e não vem na imagem do CI —, então o orçamento de memória podia estar
  sem gate nenhum sem que nada indicasse isso; agora falha fechado, com
  `PERF_ALLOW_NO_RSS=1` para tornar a dispensa explícita, e o job instala o
  pacote. A verificação de auto-contenção do NFR-3 pulava o alvo
  `aarch64-unknown-linux-gnu`, que na verdade compila num runner ARM nativo e
  podia ser verificado como os outros. E a cobertura contava como produção os
  arquivos que só existem para os testes, o que media o esforço de teste em vez
  do que ele protege — o gate agora exclui `*_test.rs`, `tests.rs` e `fakes.rs`
  do agregado e do piso por arquivo, e a limitação restante, os `mod tests`
  embutidos, está documentada em vez de escondida.
- **Política de dependências em [`deny.toml`](deny.toml), no job
  `supply-chain`.** Um aviso de segurança ou uma licença copyleft na árvore é um
  defeito que nenhum teste pega. `CDLA-Permissive-2.0` está na lista permitida
  com a razão: é licença de dados, cobre o bundle de certificados raiz que o
  rustls carrega, e não impõe obrigação sobre a distribuição do binário.
- **O produto passa a se chamar NyCode CLI e o repositório, `nycode-cli`.** O
  nome de exibição vale para títulos e prosa de documentação; o binário, as
  crates e as variáveis de ambiente continuam `nycode` e `NYCODE_*`, e nada que
  se refira ao `nylla-gateway` — header, IDs de modelo, `NYLLA_API_KEY` — foi
  tocado, porque o gateway é outro produto.
- **Pisos de cobertura elevados de 90%/80% para 95%/90%** em
  [`scripts/coverage-gate.sh`](scripts/coverage-gate.sh), com NFR-5 da
  [spec](.specs/nycode-rs/spec.md) atualizado. A tabela de exemptions segue vazia.
- `observer::Stdout` passou a ser genérico sobre os destinos de saída e de
  progresso. `Stdout::new(quiet)` mantém o comportamento anterior; a costura
  existe para que a apresentação seja verificável sem terminal.

### Corrigido

- **FR-4, FR-6 e FR-7 deixaram de ser declarados entregues.** Os três estavam
  marcados assim em [`REQUIREMENTS.md`](docs/requirements/REQUIREMENTS.md),
  [`PRD.md`](PRD.md) e [`README.md`](README.md) enquanto o código correspondente
  nunca era chamado pelo binário: não há handler de sinal e `Error::Cancelled`
  nunca é construído; `catalog::fetch` existe e nunca é invocado; `mcp::discover`
  e `McpTool` só rodam dentro dos próprios testes, o trait `Transport` não tem
  implementação real, e hooks não existiam em nenhuma forma. Cobertura de 98,6%
  não pegou nada disso, porque a cobertura mede o que o teste chama, não o que a
  produção chama. É a mesma classe de defeito que o NFR-4 proíbe no wire,
  aplicada à própria documentação.
- **Link quebrado na spec.** O cabeçalho apontava o "COMO" para um `design.md`
  que nunca existiu no diretório; agora aponta para os ADRs e a arquitetura.
- **NFR-2 dizia "30MB" na spec e "30 MiB" em todos os outros documentos.** A
  diferença é de 4,9% num número que a spec declara travado em CI. Padronizado
  em MiB, que é o que o gate mede.
- **A flag de retomada é `--continue`, como sempre esteve documentado.** O nome
  longo era derivado do campo `continue_session`, o que produzia
  `--continue-session` — uma interface que nenhum documento descrevia e que
  nenhum teste exercitava. O primeiro teste de `resolve_session` a encontrou.
