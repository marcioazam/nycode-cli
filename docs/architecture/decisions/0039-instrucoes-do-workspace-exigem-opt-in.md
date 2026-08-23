# ADR-0039: Instrucoes do workspace exigem opt-in explicito

- **Status:** aceito
- **Data:** 2026-08-17
- **Contexto relacionado:** FR-8, FR-17, `AGT-01`, ADR-0016

## Contexto

`AGENTS.md`, skills e arquivos `.nycode/SYSTEM.md` vivem no mesmo diretório que
um clone de terceiro. Colocá-los automaticamente no system prompt permite que
conteúdo controlado pelo repositório tente alterar a política do agente, pedir
permissões ou orientar exfiltração. Um marcador textual não cria uma fronteira:
o próprio conteúdo pode imitar o marcador, e o provider recebe tudo no mesmo
campo de system prompt.

O código anterior carregava arquivos do workspace sem decisão do operador
(`crates/nycode-agent/src/context/mod.rs` e
`crates/nycode-cli/src/invocation/prompt.rs`). Isso contradizia `AGT-01` e a
fronteira descrita em `docs/specs/001-fronteira-de-confianca/spec.md`.

## Decisão

Arquivos de instrução e skills do workspace não entram no system prompt por
omissão. O operador precisa passar `--trust-workspace-instructions` para esta
sessão. A flag é explícita, não é persistida no workspace e é preservada apenas
durante `/reload` da sessão corrente.

As regras de configuração do usuário continuam separadas da origem workspace.
`--system` e `--append-system` continuam sendo escolhas explícitas do operador
e suprimem os arquivos equivalentes do workspace.

Descoberta de comandos, cabeçalho e inventário de arquivos continuam possíveis;
descobrir um arquivo não concede autoridade para o seu conteúdo.

## Consequências

Positivas: abrir um clone hostil não injeta instruções automaticamente no
system prompt; a decisão de confiança fica visível na linha de comando; a
política de permissão continua em código e não em Markdown.

Negativas: repositórios que dependiam de instruções automáticas precisam da
flag; a paridade de comportamento muda deliberadamente; uma futura experiência
interativa de consentimento deve substituir a flag se o custo de uso justificar.

Descartadas: marcadores textuais, porque são falsificáveis; confiar em
política.

## Confirmação

- `cargo test -p nycode-agent` prova que contexto do workspace é ignorado sem
  opt-in e carregado com opt-in.
- `cargo test -p nycode-cli` prova parsing da flag e composição do prompt.
- O gate de segurança deve adicionar um caso adversarial que tente conceder
  `write` a partir de `AGENTS.md` sem a flag e confirme que o texto não chega ao
  system prompt.

## Revisão

Reabrir se o provider passar a oferecer canais estruturados de instrução/dados
com autoridade distinta ou se o produto implementar consentimento persistido
fora do workspace para cada declaração de instrução.
