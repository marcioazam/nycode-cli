# Contratos de serviços e disponibilidade condicional

Acesso: 2026-11-14. Relatório de scouts somente leitura, julgado pelo integrador. Pesquisa inicial: Perplexity + Exa/Parallel; seguimento: Brave e leitura primária (o scout declarou as outras ferramentas indisponíveis nesse seguimento, portanto não se afirma um segundo cruzamento Perplexity). Cópias brutas: `/tmp/tmp.QzxmJxKK2j/`. Lacunas não são prova de inexistência de API.

## Interfaces verificadas

| Comando | Efeito real documentado | Fonte primária | Estado de integração |
|---|---|---|---|
| mobile / ios / android | QR único para `https://claude.ai/mobile` | https://code.claude.com/docs/en/mobile.md e changelog 2.1.271 | Implementado em services/public.ts; QR estático verificado por decodificador de teste, sem dependência/rede em runtime |
| stickers | Desde 2.1.323 informa que os pacotes foram todos resgatados, em vez de abrir loja | https://code.claude.com/docs/en/changelog.md | Implementado como status atual; não simula estoque/compra |
| upgrade | Abre página de upgrade; imprime URL se não há navegador (fallback corrigido em 2.1.323) | https://code.claude.com/docs/en/commands.md e https://claude.com/pricing | Usa base oficial `https://claude.ai/upgrade`; destino exato/query atual do CLI não documentado. A base aparece no changelog 0.2.96 e nas ligações da página oficial de preços; HTTP 403 no fetch anônimo não autoriza inventar outro destino |
| usage-credits | Gestão de créditos depois de login claude.ai; substituiu extra-usage | https://code.claude.com/docs/en/costs.md | Conta/endpoint ainda necessários; não usa créditos de outro provedor como se fossem Anthropic |
| radio | Abre Claude FM ou imprime URL | https://code.claude.com/docs/en/commands.md; https://code.claude.com/docs/en/whats-new/2026-w27.md | URL oficial do stream não encontrada nas fontes primárias lidas. Redirect observado `clau.de/radio`→YouTube não foi promovido a contrato oficial |
| passes | Só aparece para conta elegível | https://code.claude.com/docs/en/commands.md | Elegibilidade/API não observadas |
| privacy-settings | Disponível para assinaturas Pro/Max/Ultra | https://code.claude.com/docs/en/commands.md | Estado remoto não observado |
| rate-limit-options | Exige assinatura claude.ai | https://code.claude.com/docs/en/commands.md | Não inventar limites de plano a partir dos tokens locais |
| remote-env | Escolhe ambiente de nuvem padrão | https://code.claude.com/docs/en/commands.md | Nenhum contrato verificado para anexar sessão pi |
| schedule / routines | list/update/run de tarefas em nuvem; planos Pro/Max/Ultra/Team/Enterprise | https://code.claude.com/docs/en/routines.md | Sem API pública de compatibilidade com sessão pi comprovada |
| teleport | Picker/CLI `--teleport` puxa branch e conversa de sessão Claude em nuvem | https://code.claude.com/docs/en/commands.md; https://code.claude.com/docs/en/cli-reference.md | Não executar fetch/Git nesta tarefa nem anunciar continuação de sessão pi |
| desktop | `--desktop`/comando abrem app; documentação do comando limita a macOS/Windows x64 com assinatura | https://code.claude.com/docs/en/desktop.md#coming-from-the-cli | Host é Linux. Existe beta do app Desktop Linux em documentação separada; isso NÃO comprova suporte de `--desktop` neste host |
| artifacts / design | Exigem conta/condições de artefatos e template elegível; consent/revoke concedem/retiram acesso ao Design | https://code.claude.com/docs/en/artifacts.md; https://code.claude.com/docs/en/commands.md | Não substituir backend por arquivo HTML local e chamar de mesmo serviço |
| web-setup | CLI oficial lê token de `gh`, confirma e envia à Anthropic para conectar conta | https://code.claude.com/docs/en/web-quickstart.md#connect-from-your-terminal | Nada executado. Eventual ponte deve iniciar apenas o CLI oficial com consentimento explícito; o pi NÃO deve capturar/intermediar token |

## Correções de pesquisa
- Perplexity disse que web-setup não constava da referência; o Markdown primário contém o comando, e prevalece.
- A frase inicial do scout “web-setup bloqueado por política” foi retirada: a documentação descreve pré-requisitos e uma confirmação, não uma proibição abstrata de implementar uma ponte segura. Isso não autoriza executar o fluxo durante a tarefa.
- Disponibilidade de radio: nota antiga da semana 27 excluía provedores terceiros; changelog 2.1.251 explicitamente ampliou a disponibilidade. Não manter a exclusão antiga como regra atual.
- Não se diz que todos os comandos carecem de entrypoint: CLI documenta `--desktop`, `--teleport`, `--cloud`, `claude doctor` e `claude auth status`. Não se encontrou nas páginas lidas uma API geral para controlar a sessão pi por esses serviços.

## Limites operacionais observados
`claude auth status` filtrado novamente nesta rodada: `loggedIn=false`, `authMethod=none`, `subscriptionType=null`. Não se abriram armazenamentos de credenciais nem se iniciaram login, servidor remoto, áudio, upload, compra ou sessão cloud. O usuário respondeu “Pule” à pergunta sobre ponte/sessão separada; não se converteu esse silêncio em consentimento para transferir contexto ou credenciais.

## Critério
Mostrar requisitos ou uma URL não implementa uma API privada. Uma URL é implementação válida apenas quando abrir aquela página é o próprio efeito nativo documentado (ex.: upgrade). Recursos condicionalmente ausentes no Claude original são distintos de recursos locais ainda não implementados; o estado não será maquiado na matriz.
