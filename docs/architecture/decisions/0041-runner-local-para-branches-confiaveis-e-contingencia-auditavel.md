# ADR-0041: Runner local para branches confiaveis e contingencia auditavel

- **Status:** aceito
- **Data:** 2026-08-22

## Contexto

GitHub-hosted cobra minutos e pode ficar indisponivel por billing. O projeto
precisa priorizar a verificacao local sem transformar uma declaracao local em
um check remoto falsificado.

## Decisao

O workflow usa a label self-hosted `nycode-trusted` para `push`, `merge_group`
e PR cujo head pertence ao proprio repositorio. PR de fork usa
`ubuntu-latest`, pois codigo nao confiavel nao executa na maquina do operador.

Se o runner ou GitHub Actions estiver indisponivel, `scripts/verify-all --full`
no SHA exato e evidencia valida para um override administrativo excepcional.
O operador registra na PR o SHA, o comando, a saida resumida, data, motivo e
autorizacao humana antes do override. Nenhum script publica status de sucesso
por token e nenhum merge e automatico nessa contingencia.

## Consequencias

O runner precisa permanecer online, isolado e sem credenciais desnecessarias.
Se estiver offline, checks ficam pendentes em vez de cair silenciosamente para
GitHub-hosted. A protecao normal de `main` continua exigindo os checks remotos;
o override e uma acao administrativa deliberada e auditavel.
