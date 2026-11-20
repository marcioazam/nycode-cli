# 0006: formato das instruções para o modelo

Estado: regra adotada (2026-11-16). Nenhuma migração de formato; o que já existe segue o padrão abaixo.

## Pergunta

Para falar com o modelo (Claude primeiro), XML, Markdown, JSON, YAML ou texto corrido?

## Evidência (fontes primárias lidas em 2026-11-16 por dois pesquisadores independentes)

Anthropic:

- XML separa partes de natureza diferente: "XML tags help Claude parse complex prompts unambiguously, especially when
  your prompt mixes instructions, context, examples, and variable inputs". Exemplos ficam em `<example>`, documentos em
  `<document>` ([prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
- Contexto longo: documentos no topo e pergunta no fim. "Queries at the end can improve response quality by up to 30
  percent in tests" (mesma página).
- O estilo do prompt puxa o da resposta: "removing markdown from your prompt can reduce the volume of markdown in the
  output". E vale dizer o que fazer, não o que evitar (mesma página).
- XML e Markdown aparecem como equivalentes: "techniques like XML tagging or Markdown headers [...] is likely becoming
  less important as models become more capable"
  ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- CLAUDE.md em Markdown, com títulos e listas, "target under 200 lines per CLAUDE.md file. Longer files consume more
  context and reduce adherence". Procedimento longo vira skill ([memory](https://code.claude.com/docs/en/memory)).
- Skill: frontmatter YAML e corpo Markdown. Custa cerca de 100 tokens por skill no catálogo e menos de 5 mil quando é
  carregada ([Agent Skills](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)).
- Saída de ferramenta: "there is no one-size-fits-all solution". No exemplo, a resposta `concise` gastou cerca de ⅓
  dos tokens da `detailed` ([writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents)).

Outros:

- OpenAI GPT-4.1: comece por Markdown; XML também vai bem. Com muitos documentos, "JSON performed particularly poorly"
  ([guia](https://cookbook.openai.com/examples/gpt4-1_prompting_guide)).
- Google Gemini: XML ou títulos Markdown; "Choose one format and use it consistently within a single prompt"
  ([estratégias](https://aistudio.google.com/docs/prompting-strategies)).
- Formato muda o resultado em até 40% no GPT-3.5; o GPT-4 é mais robusto ([arXiv 2411.10541](https://arxiv.org/abs/2411.10541)).
- Exigir JSON durante o raciocínio derruba o acerto (GSM8K, claude-3-haiku) ([arXiv 2408.02442](https://arxiv.org/abs/2408.02442)).
- Custo: em medições de terceiros, XML gasta muito mais tokens que Markdown para os mesmos dados. Os números são de
  tokenizer da OpenAI e de outros modelos, e não foram verificados para Claude.

Nenhum estudo lido compara XML e Markdown no Claude atual.

## Conclusão

Nenhum formato vence sempre. A Anthropic dá funções para cada um, e daí sai a regra. Markdown estrutura o texto, XML
delimita material de outra natureza e JSON serve só quando um programa vai ler. Migrar o que existe para XML não tem
ganho provado no Claude e custa tokens, então não migramos.

## Regra

1. Instruções sempre carregadas (CLAUDE.md, rules) e corpo de skill: Markdown com títulos e listas curtas, sem XML em
   volume. Frase positiva ("faça X") no lugar da proibição, quando a regra permitir.
2. Material colado num prompt ou brief (documento, log, diff, saída de outra ferramenta, exemplo, entrada do usuário)
   vai numa tag XML de nome estável (`<document>`, `<example>`, `<input>`). Documentos longos ficam antes da tarefa,
   e a pergunta vai no fim.
3. Um estilo por prompt: não misture seções em XML com seções em títulos Markdown para o mesmo papel.
4. Saída de ferramenta: compacta e filtrada. Tabela Markdown ou chave-valor para listas, JSON só quando outro código vai
   ler, e nomes legíveis no lugar de ids opacos.
5. Saída estruturada: deixe o modelo raciocinar livre e peça o formato fixo (JSON, tags) só no passo final.
6. O estilo do prompt casa com o da resposta desejada. Prompt para resposta em prosa não vem cheio de Markdown.
7. Mudar o formato de uma peça sempre carregada é mudança de custo e acerto: passa pelo gate e pela regra de custo ×
   benefício, com contagem de tokens do próprio provedor, não por estimativa de outro tokenizer.
