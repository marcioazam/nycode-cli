/** `/subagents-setup [show|off]` (docs/subagent-routing-2026-11-13.md, AC1/AC2). */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { OVERLAY_OPTIONS } from '../fleet-ui/viewer.ts'
import { type Effort, EFFORTS, formatPolicy, loadPolicy, policyFile, removePolicy, type RoutingPolicy, savePolicy } from './policy.ts'
import { SetupComponent, type SetupModel } from './setup-ui.ts'

type Handler = Parameters<ExtensionAPI['registerCommand']>[1]['handler']
type CommandCtx = Parameters<Handler>[1]

/** The efforts pi reports for the model, in ladder order (`off` is a level too). */
function supportedEfforts(model: Parameters<typeof getSupportedThinkingLevels>[0]): Effort[] {
  const levels = getSupportedThinkingLevels(model) as string[]
  return EFFORTS.filter((e) => levels.includes(e))
}

const setupModels = (ctx: CommandCtx): SetupModel[] =>
  ctx.modelRegistry
    .getAvailable()
    .map((m) => ({ key: `${m.provider}/${m.id}`, levels: supportedEfforts(m) }))
    .filter((m) => m.levels.length > 0)

const runSetup = (ctx: CommandCtx, models: SetupModel[]): Promise<RoutingPolicy | undefined> => {
  const current = loadPolicy()
  return ctx.ui.custom<RoutingPolicy | undefined>((tui, _theme, _kb, done) => new SetupComponent({ models, current, done, requestRender: () => tui.requestRender() }), { overlay: true, overlayOptions: { ...OVERLAY_OPTIONS } })
}

/** `onChange` runs after the policy file changed, so the tool can re-register with the new description and schema. */
export function registerRoutingCommand(pi: ExtensionAPI, onChange: () => void): void {
  pi.registerCommand('subagents-setup', {
    description: 'Choose the models and efforts subagents may use (show | off)',
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase()
      if (arg === 'show') return ctx.ui.notify(formatPolicy(loadPolicy()), 'info')
      if (arg === 'off') {
        let removed: boolean
        try {
          removed = removePolicy()
        } catch (error) {
          return ctx.ui.notify(`Could not remove ${policyFile()}: ${(error as Error).message}`, 'error')
        }
        onChange()
        return ctx.ui.notify(removed ? `Subagent routing off (removed ${policyFile()}).` : formatPolicy(undefined), 'info')
      }
      if (arg) return ctx.ui.notify('Usage: /subagents-setup [show|off]', 'error')
      if (!ctx.hasUI) return ctx.ui.notify('/subagents-setup needs the interactive TUI; use /subagents-setup show or off here.', 'error')
      const models = setupModels(ctx)
      if (models.length === 0) return ctx.ui.notify('No models available to choose from.', 'error')
      const policy = await runSetup(ctx, models)
      if (!policy) return ctx.ui.notify('Subagent routing unchanged.', 'info')
      savePolicy(policy)
      onChange()
      ctx.ui.notify(`Saved.\n${formatPolicy(policy)}`, 'info')
    },
  })
}
