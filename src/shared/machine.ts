import { applySubEvent, tickSubs } from './subagents'
import type { HookEvent, PetState, Session, Settings } from './types'

export const COMPLETED_HOLD_MS = 6_000
export const STALE_MS = 120_000 // THINKING/WORKING sem nenhum evento => estado incerto
export const WAIT_STALE_MS = 15 * 60_000

export function projectName(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || cwd || '(desconhecido)'
}

export function newSession(id: string, cwd = '', now = 0): Session {
  return {
    id, cwd, project: projectName(cwd), state: 'UNKNOWN', stateSince: now, lastEventAt: 0,
    origin: 'unknown', liveness: 'unknown', pinned: false, subagents: 0, log: []
  }
}

function set(s: Session, state: PetState, now: number) {
  if (s.state !== state) { s.state = state; s.stateSince = now }
}

/** Reducer: evento do hook -> nova sessão (imutável). */
export function applyEvent(prev: Session, e: HookEvent): Session {
  const s: Session = { ...prev, log: [...prev.log] }
  const now = e.ts
  if (e.cwd && e.cwd !== s.cwd) { s.cwd = e.cwd; s.project = projectName(e.cwd) }
  s.lastEventAt = now
  s.liveness = 'active'
  s.note = undefined
  s.log.push({ ts: now, event: e.event, tool: e.tool })
  if (s.log.length > 50) s.log.splice(0, s.log.length - 50)

  switch (e.event) {
    case 'SessionStart':
      set(s, 'IDLE', now); s.tool = undefined; s.subagents = 0; break
    case 'UserPromptSubmit':
      set(s, 'THINKING', now); s.tool = undefined; break
    case 'PreToolUse':
      set(s, 'WORKING', now); s.tool = e.tool; break
    case 'PostToolUse':
      // progresso: a resposta ainda não terminou
      set(s, 'THINKING', now); s.tool = undefined; break
    case 'PostToolUseFailure':
      set(s, 'THINKING', now); s.tool = undefined; s.note = `Falha em ${e.tool ?? 'ferramenta'}`; break
    case 'PermissionRequest':
      set(s, 'WAITING_PERMISSION', now); s.tool = e.tool; break
    case 'Notification':
      if (e.notificationType === 'permission_prompt') set(s, 'WAITING_PERMISSION', now)
      else if (e.notificationType === 'idle_prompt' && s.state !== 'WAITING_PERMISSION') set(s, 'IDLE', now)
      else s.note = e.message // informativo: não muda estado
      break
    case 'Stop':
      set(s, 'COMPLETED', now); s.tool = undefined; break // NÃO encerra a sessão
    case 'StopFailure':
      set(s, 'ERROR', now); s.tool = undefined; s.note = e.error; break
    case 'SubagentStart': s.subagents += 1; break
    case 'SubagentStop': s.subagents = Math.max(0, s.subagents - 1); break
    case 'TaskCreated': case 'TaskCompleted': s.note = e.taskSubject; break
    case 'SessionEnd':
      s.liveness = 'ended'; set(s, 'DISCONNECTED', now); s.tool = undefined; break
    default: break // evento desconhecido: só registra atividade
  }
  applySubEvent(s, e) // subagentes (janela Equipes); não altera o estado da sessão
  return s
}

/** Decaimento por tempo: COMPLETED->IDLE, estados ativos sem evidência -> UNKNOWN. */
export function tick(p0: Session, now: number): Session {
  const subs = tickSubs(p0.subs, now)
  const prev = subs ? { ...p0, subs } : p0
  const age = now - prev.stateSince
  const silent = now - prev.lastEventAt
  if (prev.liveness === 'ended') return prev
  if (prev.state === 'COMPLETED' && age > COMPLETED_HOLD_MS) return { ...prev, state: 'IDLE', stateSince: now }
  if ((prev.state === 'THINKING' || prev.state === 'WORKING') && prev.lastEventAt && silent > STALE_MS)
    return { ...prev, state: 'UNKNOWN', stateSince: now, liveness: 'unknown', note: 'Aguardando eventos' }
  if (prev.state === 'WAITING_PERMISSION' && silent > WAIT_STALE_MS)
    return { ...prev, state: 'UNKNOWN', stateSince: now, liveness: 'unknown', note: 'Aguardando eventos' }
  return prev
}

const RANK_ATTENTION: PetState[] = ['WAITING_PERMISSION', 'ERROR', 'WORKING', 'THINKING', 'COMPLETED', 'IDLE', 'UNKNOWN', 'DISCONNECTED']

export const STATE_LABEL: Record<PetState, string> = {
  IDLE: 'Ocioso', THINKING: 'Pensando', WORKING: 'Trabalhando', WAITING_PERMISSION: 'Aguardando aprovação',
  COMPLETED: 'Concluído', ERROR: 'Erro', DISCONNECTED: 'Desconectado', UNKNOWN: 'Aguardando eventos'
}

/** Escolhe a sessão exibida pelo pet. Sessão selecionada manualmente vence a política. */
export function pickDisplay(
  sessions: Session[], cfg: Pick<Settings, 'policy' | 'watchedSessionId'>
): { state: PetState; sessionId: string | null; label: string } {
  const live = sessions.filter((s) => s.liveness !== 'ended')
  if (cfg.watchedSessionId) {
    const w = sessions.find((s) => s.id === cfg.watchedSessionId)
    if (w) return { state: w.state, sessionId: w.id, label: `${w.project}: ${STATE_LABEL[w.state]}` }
  }
  if (!live.length) return { state: 'DISCONNECTED', sessionId: null, label: 'Nenhuma sessão ativa' }
  const pinned = (s: Session) => (s.pinned ? 0 : 1)
  const sorted = [...live].sort((a, b) => {
    if (cfg.policy === 'recent') return b.lastEventAt - a.lastEventAt
    return (
      RANK_ATTENTION.indexOf(a.state) - RANK_ATTENTION.indexOf(b.state) ||
      pinned(a) - pinned(b) || b.lastEventAt - a.lastEventAt
    )
  })
  const top = sorted[0]
  return { state: top.state, sessionId: top.id, label: `${top.project}: ${STATE_LABEL[top.state]}` }
}
