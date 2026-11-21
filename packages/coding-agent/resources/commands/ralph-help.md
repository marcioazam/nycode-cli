---
description: "Explica o Ralph Loop e os commands dele no pi (/ralph-loop, /cancel-ralph)"
disable-model-invocation: true
---

<!-- Porte para o pi (2026-11-11) do /ralph-loop:help (ralph-loop 1.0.1); renomeado para não colidir com ajudas do pi. -->

Explique ao usuário, em português, sem usar ferramentas:

## O que é o Ralph Loop

A técnica "Ralph Wiggum" de Geoffrey Huntley (https://ghuntley.com/ralph/): o mesmo prompt é dado ao agente várias
vezes. O lado "autorreferente" vem de o agente ver o próprio trabalho anterior nos arquivos e no histórico do git, não de
a saída voltar como entrada. A cada iteração: o agente recebe o MESMO prompt, trabalha, tenta parar, o Stop hook
intercepta e devolve o prompt, e ele continua de onde os arquivos estão, até concluir.

## Commands no pi

- `/ralph-loop PROMPT [--max-iterations N] [--completion-promise TEXTO]`: inicia o loop nesta sessão. Grava o estado em
  `.claude/ralph-loop.local.md` no diretório atual; o Stop hook (registrado em `~/.pi/agent/claude-home/settings.json`)
  devolve o prompt até achar `<promise>TEXTO</promise>` na última resposta ou chegar ao limite. Exemplo:
  `/ralph-loop "Corrija o refresh de token em auth.ts. Escreva <promise>FIXED</promise> quando os testes passarem."
  --completion-promise "FIXED" --max-iterations 10`
- `/cancel-ralph`: apaga o arquivo de estado e informa a iteração em que estava.

Sem `--completion-promise` nem `--max-iterations` o loop não para sozinho.

## Quando usar

Bom para tarefa bem definida com critério de sucesso claro, que pede iteração (testes passando, build verde). Ruim para
decisões de design, tarefas de um passo, critério vago ou depuração de produção.

## Diferença para o /goal do pi

O `/goal <condição>` também mantém a sessão trabalhando, mas quem decide se terminou é outro modelo que lê a conversa (não
uma frase que o próprio agente escreve). Prefira o `/goal` quando a condição é verificável por evidência; o Ralph quando
o mesmo prompt repetido é o que você quer.
