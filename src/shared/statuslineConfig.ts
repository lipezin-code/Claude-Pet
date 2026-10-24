// Merge/restauração PURA do campo "statusLine" do settings.json do Claude Code. Nada além desse campo é tocado.
export const STATUSLINE_MARKER = 'claude-pet-statusline'

type Json = Record<string, any>

export const isOurStatusLine = (sl: unknown) =>
  !!sl && typeof sl === 'object' && String((sl as Json).command ?? '').toLowerCase().includes(STATUSLINE_MARKER)

/** Comando da ponte. Barras normais: funcionam igual no Git Bash e no cmd. */
export const bridgeCommand = (nodePath: string, script: string) =>
  `"${nodePath.replace(/\\/g, '/')}" "${script.replace(/\\/g, '/')}"`

/** Instala a ponte no lugar da statusLine atual (mantém padding dela, se houver). */
export function installStatusLine(settings: Json, command: string): Json {
  const cur = settings.statusLine
  const sl: Json = { type: 'command', command }
  if (cur && typeof cur === 'object' && typeof cur.padding === 'number') sl.padding = cur.padding
  return { ...settings, statusLine: sl }
}

/** Volta o campo ao valor original (ou o remove, se não havia). */
export function restoreStatusLine(settings: Json, original: unknown): Json {
  const out: Json = { ...settings }
  if (original === undefined || original === null) delete out.statusLine
  else out.statusLine = original
  return out
}

/** Comando a encadear: só se a original for do tipo command e não for a nossa. */
export function chainOf(original: unknown): string | null {
  const o = original as Json
  return o && o.type === 'command' && typeof o.command === 'string' && o.command && !isOurStatusLine(o) ? o.command : null
}
