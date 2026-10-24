// Merge/remoção PURA do bloco "hooks" do settings.json do Claude Code.
// Nunca toca em entradas de terceiros: só adiciona/remove as nossas (marcadas pelo caminho do script).
export const HOOK_EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop',
  'TaskCreated', 'TaskCompleted', 'TeammateIdle'
] as const

export const MARKER = 'claude-pet-hook'

type Json = Record<string, any>

const isOurs = (h: Json) =>
  JSON.stringify([h?.command, h?.args]).toLowerCase().includes(MARKER)

export function mergeHooks(settings: Json, nodePath: string, scriptPath: string): Json {
  const out: Json = { ...settings, hooks: { ...(settings.hooks ?? {}) } }
  for (const ev of HOOK_EVENTS) {
    const groups: Json[] = [...(out.hooks[ev] ?? [])]
    const has = groups.some((g) => (g.hooks ?? []).some(isOurs))
    if (!has) {
      groups.push({ hooks: [{ type: 'command', command: nodePath, args: [scriptPath], async: true, timeout: 5 }] })
    } else {
      // atualiza caminho do node/script se mudou
      for (const g of groups) g.hooks = (g.hooks ?? []).map((h: Json) => (isOurs(h) ? { ...h, command: nodePath, args: [scriptPath] } : h))
    }
    out.hooks[ev] = groups
  }
  return out
}

export function removeHooks(settings: Json): Json {
  if (!settings.hooks) return settings
  const hooks: Json = {}
  for (const [ev, groups] of Object.entries<Json[]>(settings.hooks)) {
    const kept = (groups ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h: Json) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0)
    if (kept.length) hooks[ev] = kept
  }
  const out: Json = { ...settings }
  if (Object.keys(hooks).length) out.hooks = hooks
  else delete out.hooks
  return out
}

export function installedEvents(settings: Json): string[] {
  return HOOK_EVENTS.filter((ev) => (settings.hooks?.[ev] ?? []).some((g: Json) => (g.hooks ?? []).some(isOurs)))
}
