/**
 * Lista de tarefas sempre em dia: quando há itens abertos e várias chamadas de ferramenta passam sem nenhuma
 * atualização da lista, o próximo resultado de ferramenta leva um lembrete curto.
 *
 * Motivo (2026-11-15): em sessões longas a lista ficava parada num item já concluído e a aba Todo mostrava um
 * estado falso. O Claude Code resolve o mesmo com um lembrete de sistema quando a lista fica sem uso.
 *
 * Custo: nada no prompt fixo e nenhum turno extra. O lembrete vai no fim de um resultado de ferramenta (não toca o
 * prefixo em cache), no máximo um a cada EVERY chamadas, e só com item aberto. Sem lista ou com tudo concluído, a
 * extensão não escreve nada.
 *
 * O estado vem do evento `pi-code:todos` que a extensão todo do pi-code emite a cada mudança e ao recarregar a sessão.
 * PI_TODO_SYNC=0 desliga. Reverter: apagar este diretório.
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export type Item = { id: number; text: string; status: string }

/** Chamadas de ferramenta sem tocar na lista antes de lembrar. */
export const EVERY = 10

/** Texto do lembrete, ou undefined quando não há item aberto. */
export function reminder(items: Item[], calls: number): string | undefined {
  const open = items.filter((t) => t.status !== 'completed')
  if (open.length === 0) return undefined
  const active = open.find((t) => t.status === 'in_progress')
  const where = active ? `in progress: #${active.id} "${active.text}"` : 'none in progress'
  return `<system-reminder>The todo list has ${open.length} open item(s) (${where}) and the last ${calls} tool calls did not update it. If an item is finished, complete it now; if the work moved to another item, start that one; add what is missing. If the list is accurate, carry on and do not mention this reminder.</system-reminder>`
}

export default function (pi: ExtensionAPI) {
  if (process.env.PI_TODO_SYNC === '0') return
  let items: Item[] = []
  let calls = 0
  pi.events.on('pi-code:todos', (data: unknown) => {
    items = Array.isArray(data) ? (data as Item[]) : []
  })
  pi.on('tool_result', (event) => {
    if (event.toolName === 'todo') {
      calls = 0
      return undefined
    }
    calls += 1
    if (calls < EVERY) return undefined
    const text = reminder(items, calls)
    calls = 0
    if (!text || !Array.isArray(event.content)) return undefined
    return { content: [...event.content, { type: 'text' as const, text }] }
  })
}
