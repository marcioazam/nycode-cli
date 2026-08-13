# ADR-0001: OAuth de assinatura é um risco aceito, atrás de flag e desligado por padrão

- **Status:** aceito
- **Data:** 2026-08-13
- **Contexto relacionado:** [`spec.md`](../../../.specs/nycode-rs/spec.md) FR-9, FR-10

## Contexto

O NyCode CLI precisa autenticar contra provedores de modelo. Existem dois
caminhos: chave de API emitida pelo console do provedor, e token OAuth emitido
para uma assinatura de consumidor (Claude Pro/Max, ChatGPT Plus/Pro, GitHub
Copilot).

O segundo caminho deixou de ser viável para clientes de terceiros ao longo de 2026:

- Em fevereiro de 2026 a Anthropic atualizou os Consumer Terms declarando que OAuth
  de contas Free, Pro e Max é destinado exclusivamente ao Claude Code e ao
  claude.ai, e que usar esses tokens em qualquer outro produto, ferramenta ou
  serviço — **incluindo o Agent SDK** — constitui violação.
- Desde janeiro de 2026 há enforcement server-side. Tokens de assinatura usados
  fora do cliente oficial recebem `This credential is only authorized for use with
  Claude Code and cannot be used for other API requests.`
- O client ID do Claude Code é hardcoded e a Anthropic não registra client IDs de
  terceiros, então não existe caminho autorizado para um cliente novo.
- O OpenCode removeu o suporte nativo de auth Anthropic no PR #18186, em
  2026-03-19, por compliance. Goose, Cline e Roo Code tiveram tokens bloqueados.
- O criador do OpenClaw teve a conta banida em 2026-04-04 por rotear OAuth de
  assinatura através de cliente HTTP próprio.

O `nylla-gateway` já resolve esse problema de outra forma: relaia contas próprias
do operador com fidelidade de wire e expõe o resultado como API padrão, de modo que
um cliente que fala com o gateway usando chave de API não incorre no padrão
proibido.

## Decisão

O NyCode CLI implementa OAuth de assinatura, com o risco explicitamente aceito
pela liderança do projeto, sob quatro restrições que não são negociáveis:

1. **Compilação condicional.** O código vive atrás da feature `subscription-oauth`,
   que não faz parte das features padrão. Um build padrão não contém o caminho.
2. **Desligado em runtime mesmo quando compilado.** Habilitar exige ação explícita
   e informada do operador, nunca herança de configuração ou detecção automática de
   credencial no ambiente.
3. **Degradação limpa.** Quando um provedor bloquear o token, o cliente cai para
   chave de API ou para o gateway e informa o motivo. Nunca uma falha opaca, nunca
   uma tentativa de contornar o bloqueio, nunca personificação de outro cliente.
4. **Aviso na superfície.** [`NOTICE`](../../../NOTICE) declara o risco de violação
   de termos e de suspensão de conta, seguindo o padrão que o `nylla-gateway` já
   estabeleceu para o caso Kiro.

O caminho recomendado e o padrão de instalação continuam sendo o gateway.

## Consequências

Positivas: a decisão fica registrada, auditável e isolada num único crate. Remover
o recurso é apagar uma feature do `Cargo.toml`, não refatorar o cliente.

Negativas: o NyCode CLI carrega um caminho de código cujo funcionamento depende
de uma política de terceiro que já se moveu contra ele uma vez e pode se mover
de novo. Usuários que habilitarem a flag assumem risco de suspensão da própria
conta. O projeto não pode oferecer garantia de funcionamento desse caminho.

Descartadas: implementar sem flag e por padrão, que exporia todo usuário ao risco
sem consentimento; e omitir o recurso por completo, que era a recomendação técnica
mas foi sobreposta por decisão de produto informada.

## Revisão

Este ADR é revisto se um provedor publicar um caminho autorizado para clientes de
terceiros, ou se o enforcement passar a atingir usuários do NyCode CLI. No
segundo caso, a ação padrão é remover a feature, não contorná-la.
