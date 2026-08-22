# Runbook — NyCode CLI

Detecção, confirmação, mitigação e escalonamento para os modos de falha mais
prováveis. Um CLI local não tem incidente de produção no sentido de serviço —
não há usuário terceiro afetado por uma instância caindo —, mas tem os três
abaixo, que são os que mais custam tempo quando ninguém documentou o
diagnóstico antes.

## 1. Confinamento do shell indisponível

**Detecção.** O usuário vê o aviso de que o comando de shell está rodando sem
confinamento do sistema operacional (FR-11) — nunca silencioso, por decisão
de spec. Em CI, os testes de `policy::confinement` falham ou pulam com uma
mensagem citando `bubblewrap`/`Seatbelt` ausente.

**Confirmação.** Rode o binário de detecção do confinamento diretamente:
`sandbox::detect_from_path().is_enforced()` é o que os testes chamam; fora de
teste, o próprio aviso ao usuário já confirma. Em runner de CI Ubuntu
24.04+, a causa mais comum é `userns` não privilegiado bloqueado por padrão —
ver o histórico de commits deste repositório para os dois sysctl que
destravam isso (AppArmor e o toggle de kernel Debian/Ubuntu), aplicados só ao
ambiente do job, nunca ao binário de produção.

**Mitigação.** Não existe fallback silencioso — é decisão de spec, não bug.
Em desenvolvimento local: instale `bubblewrap` (Linux) ou confirme que o
Seatbelt está disponível (macOS, vem com o sistema). Em CI: verifique se o
runner permite criação de namespace de rede antes de assumir que é defeito do
harness.

**Escalonamento.** Se o confinamento está disponível no ambiente e o aviso
aparece mesmo assim, é bug — abra investigação em
`crates/nycode-agent/src/policy/confinement/`. Se o ambiente genuinamente não
suporta confinamento (contêiner sem privilégio, por exemplo), não há
escalonamento: o produto está se comportando como a spec pede.

## 2. Gateway inacessível ou falha de autenticação

**Detecção.** A sessão falha ao abrir, ou o primeiro turno retorna erro de
transporte. `nycode -p "..."` com `--output-format json` emite o envelope de
erro estruturado em vez de resposta.

**Confirmação.** Verifique `NYCODE_BASE_URL` e `NYCODE_API_KEY` (ou o bloco
`provider` de `~/.config/nycode/settings.json`, se configurado — a flag vence
o arquivo). Um 401 do gateway é fidelidade de wire funcionando corretamente
(NFR-4): o harness não inventa sucesso quando o provedor recusa.

**Mitigação.** Confirme a credencial no cofre do sistema
(`nycode auth login` regrava); confirme que o `base_url` aponta para um
gateway de fato no ar. Não há retry automático que mascare a falha — por
desenho, um erro in-band chega ao usuário como o gateway o emitiu.

**Escalonamento.** Se a credencial e o endpoint estão corretos e o erro
persiste, é problema do lado do gateway (`nylla-gateway`), fora do escopo
deste repositório — reporte lá, com o envelope de erro estruturado que o
`--output-format json` produziu.

## 3. Gate de CI verde local, vermelho remoto (ou o inverso)

**Detecção.** `scripts/ci-local.sh --full` passa na máquina de quem
desenvolveu, mas o mesmo commit falha no job correspondente do GitHub
Actions — ou o oposto. O baseline local não substitui os gates remotos que
dependem da base real do PR, da imagem ou da referência de paridade; compare
apenas etapas equivalentes antes de concluir que há divergência.

**Confirmação.** As duas causas raiz já observadas neste repositório:

- **Locale.** Um gate que ordena caminhos com `sort` sem fixar `LC_ALL`
  produz saída diferente dependendo da colação do ambiente — `.` e `/`
  trocam de ordem entre `en_US.UTF-8` e `C`. Sintoma: um gate de
  comparação de conteúdo (como `scripts/gen-test-map.sh --check`) reprova
  sem nenhum arquivo de origem ter mudado.
- **Ancestralidade quebrada por squash-merge.** Depois de um PR ser
  squash-mergeado, qualquer branch ainda empilhada sobre o commit original
  perde o ancestral comum com `origin/main` — `git merge-base` passa a
  resolver muito mais atrás do que deveria, e um gate que mede diff contra a
  base (como `scripts/agent-pr-size-gate.sh`) passa a ver um diff inflado
  com conteúdo que já foi mergeado. Sintoma: o gate reprova com uma contagem
  de linhas/arquivos muito maior do que o PR de fato introduz.

**Mitigação.** Para locale: force `LC_ALL=C` (ou equivalente) no topo de
qualquer script que ordena e depois compara texto. Para ancestralidade:
`git merge-base origin/main <branch>` revela a divergência; resolva
mesclando `origin/main` de volta na branch (nunca rebase com force-push numa
branch já publicada) — antes de resolver conflitos, prove que é seguro
comparando a árvore de `origin/main` contra o commit exato de onde a branch
partiu (`git diff origin/main <commit-de-origem> --stat`, vazio = seguro
tomar o lado da branch em todo conflito).

**Escalonamento.** Se nenhuma das duas causas explica a divergência, pare
antes de mergear — um CI remoto que diverge do local e ninguém entende por
quê é exatamente o cenário que este princípio existe para nunca deixar
acontecer sem investigação.

## 4. GitHub Actions indisponível ou sem billing

**Detecção.** Jobs permanecem pendentes por indisponibilidade do GitHub-hosted,
ou o runner `nycode-trusted` está offline. Não altere a proteção de `main` nem
publique status de check com token local para aparentar que o CI rodou.

**Mitigação.** Em branch confiável, execute no SHA exato da PR:

```sh
git rev-parse HEAD
scripts/verify-all --full
git diff --check "origin/<base>...HEAD"
```

Registre um comentário na PR com o SHA, data e hora, os comandos acima, o
resultado, o motivo da indisponibilidade e a autorização humana para override.
O `--full` local é evidência válida; o merge continua sendo uma ação
administrativa explícita, nunca automática.

**Recuperação.** Quando o runner ou GitHub Actions voltar, permita que os
checks normais concluam novamente. Investigue o runner antes de recolocá-lo em
serviço; ele deve usar a label `nycode-trusted`, ficar isolado e não conter
credenciais desnecessárias.
