import { newSession } from '../shared/machine'
import type { AgentTeam } from '../shared/agentTeams'
import type { Team } from '../shared/teams'
import type { PetState, Session } from '../shared/types'

// Só p/ o preview (#preview-teams): equipe e sessões fictícias passando pelo MESMO caminho do app (agentStatus etc.).
const ses = (id: string, state: PetState, last: string, ago: number, now: number, extra: Partial<Session> = {}): Session => ({
  ...newSession(id, 'C:\\Projetos\\loja-checkout', now - ago), state, liveness: 'active', origin: 'cli', lastEventAt: now - ago,
  stateSince: now - ago, log: [{ ts: now - ago - 1000, event: 'UserPromptSubmit' }, { ts: now - ago, event: last }], ...extra
})

export function demoSessions(now = Date.now()): Session[] {
  return [
    ses('lead0000-demo', 'THINKING', 'PostToolUse', 2_000, now),
    ses('back0000-demo', 'WORKING', 'PreToolUse', 4_000, now, { tool: 'Bash' }),
    ses('front000-demo', 'WAITING_PERMISSION', 'PermissionRequest', 90_000, now, { tool: 'Edit' }),
    ses('test0000-demo', 'UNKNOWN', 'PreToolUse', 180_000, now), // estava no meio de uma resposta e calou: parou de responder
    ses('revi0000-demo', 'IDLE', 'Stop', 60_000, now),
    // líder de uma Agent Team: membros chegam como agent_type = nome (como no teste real); 1 subagente comum
    ses('22624737-demo', 'WORKING', 'PreToolUse', 1_000, now, {
      tool: 'Agent', project: 'pasta teste', cwd: 'C:/pasta teste',
      subs: [
        { id: 'aback-1', type: 'back', state: 'working', since: now - 30_000, lastEventAt: now - 2_000, tool: 'Read' },
        { id: 'afront-1', type: 'front', state: 'done', since: now - 30_000, lastEventAt: now - 8_000 },
        { id: 'aexp-1', type: 'Explore', state: 'working', since: now - 5_000, lastEventAt: now - 1_000 }
      ],
      teamTasks: { front: { subject: 'Revisar legibilidade do README', done: true } }
    })
  ]
}

export function demoTeam(): Team {
  type A = Team['agents'][number]
  const a = (id: A['id'], kind: A['kind'], label: string, slug: string, sessionId: string): A => ({ id, kind, label, slug, sessionId })
  return {
    id: 'equipe', name: 'loja-checkout', goal: 'Refazer o checkout com Pix e testes e2e',
    agents: [
      a('lider', 'lider', 'Líder', 'lider', 'lead0000-demo'),
      a('a1', 'backend', 'Back-end', 'back-end', 'back0000-demo'),
      a('a2', 'frontend', 'Front-end', 'front-end', 'front000-demo'),
      a('a3', 'testes', 'Testes', 'testes', 'test0000-demo'),
      a('a4', 'seguranca', 'Segurança', 'seguranca', 'revi0000-demo')
    ]
  }
}

export const demoAgentTeam = (): AgentTeam => ({
  id: 'session-22624737', leadSessionId: '22624737-demo', ambiguous: ['explore'], ended: false, seenAt: Date.now(),
  members: [
    { name: 'back', agentType: 'caveman:cavecrew-reviewer', color: 'blue', joinedAt: 1 },
    { name: 'front', agentType: 'caveman:cavecrew-reviewer', color: 'green', joinedAt: 2 },
    { name: 'explore', agentType: 'desconhecido', color: 'desconhecido', joinedAt: 3 }
  ]
})
