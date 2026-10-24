import type { HookEvent, Session } from './types'

// Subagentes (ferramenta Agent) rodam DENTRO da sessão de quem os chamou: mesmo session_id, eventos com agent_id.
// Membros de Agent Team (in-process) chegam do mesmo jeito, com agent_type = nome do membro.
export type SubState = 'working' | 'needs_you' | 'done' | 'stalled' | 'idle' // idle = TeammateIdle (membro de Agent Team)
export interface SubAgent { id: string; type: string; state: SubState; since: number; lastEventAt: number; tool?: string }

export const SUB_STALE_MS = 120_000 // trabalhando sem nenhum evento => parou de responder
const MAX_SUBS = 20

/** Aplica um evento aos subagentes da sessão (muta `s`, que já é cópia em applyEvent). */
export function applySubEvent(s: Session, e: HookEvent) {
  const now = e.ts
  // Agent Teams: tarefa por membro (só quando o hook diz de quem é; a criada pelo líder sem dono fica de fora)
  if (e.teammate && e.taskSubject && (e.event === 'TaskCreated' || e.event === 'TaskCompleted')) {
    const tasks = { ...s.teamTasks, [e.teammate]: { subject: e.taskSubject.slice(0, 120), done: e.event === 'TaskCompleted' } }
    s.teamTasks = Object.fromEntries(Object.entries(tasks).slice(-20))
  }
  // TeammateIdle: membro terminou a vez e espera (não é "concluído" nem "parou de responder")
  if (e.event === 'TeammateIdle' && e.teammate) {
    const subs = [...(s.subs ?? [])]
    let k = e.agentId ? subs.findIndex((x) => x.id === e.agentId) : -1
    if (k < 0) k = subs.reduce((b, x, j) => (x.type === e.teammate && (b < 0 || x.lastEventAt > subs[b].lastEventAt) ? j : b), -1)
    if (k < 0) subs.push({ id: e.agentId ?? `tm:${e.teammate}`, type: e.teammate, state: 'idle', since: now, lastEventAt: now })
    else subs[k] = { ...subs[k], state: 'idle', tool: undefined, lastEventAt: now }
    s.subs = subs.slice(-MAX_SUBS)
    return
  }
  if (!e.agentId) return
  const subs = [...(s.subs ?? [])]
  let i = subs.findIndex((x) => x.id === e.agentId)
  if (e.event === 'SubagentStart' || i < 0) {
    if (i >= 0) return // SubagentStart repetido
    subs.push({ id: e.agentId, type: e.agentType ?? '?', state: 'working', since: now, lastEventAt: now })
    i = subs.length - 1
  }
  const sub = { ...subs[i], lastEventAt: now }
  switch (e.event) {
    case 'SubagentStop': sub.state = 'done'; sub.tool = undefined; break
    case 'PreToolUse': sub.state = 'working'; sub.tool = e.tool; break
    case 'PostToolUse': case 'PostToolUseFailure': sub.state = 'working'; sub.tool = undefined; break
    case 'PermissionRequest': sub.state = 'needs_you'; sub.tool = e.tool; break
    case 'Notification': if (e.notificationType === 'permission_prompt') sub.state = 'needs_you'; break
    default: if (sub.state !== 'done') sub.state = 'working'
  }
  subs[i] = sub
  // limite: descarta os concluídos mais antigos
  while (subs.length > MAX_SUBS) subs.splice(Math.max(0, subs.findIndex((x) => x.state === 'done')), 1)
  s.subs = subs
}

/** Decaimento: subagente trabalhando calado há SUB_STALE_MS => parou de responder. Devolve null se nada mudou. */
export function tickSubs(subs: SubAgent[] | undefined, now: number): SubAgent[] | null {
  if (!subs?.some((x) => x.state === 'working' && now - x.lastEventAt > SUB_STALE_MS)) return null
  return subs.map((x) => (x.state === 'working' && now - x.lastEventAt > SUB_STALE_MS ? { ...x, state: 'stalled' as const, tool: undefined } : x))
}
