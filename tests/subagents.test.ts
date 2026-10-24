import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TeamStore } from '../src/main/teams'
import { applyEvent, newSession, tick } from '../src/shared/machine'
import { SUB_STALE_MS } from '../src/shared/subagents'
import { subCount } from '../src/shared/teams'
import type { HookEvent, Session } from '../src/shared/types'

const ev = (event: string, ts: number, x: Partial<HookEvent> = {}): HookEvent => ({ sessionId: 'lead0001', event, ts, ...x })
const run = (events: HookEvent[]) => events.reduce((s, e) => applyEvent(s, e), newSession('lead0001', 'C:/p', 0) as Session)

// o que o líder fez no teste real: 2 subagentes em paralelo
const parallel = [
  ev('UserPromptSubmit', 1),
  ev('SubagentStart', 4, { agentId: 'ag-back', agentType: 'implementador' }),
  ev('SubagentStart', 5, { agentId: 'ag-front', agentType: 'implementador' }),
  ev('PreToolUse', 6, { agentId: 'ag-back', agentType: 'implementador', tool: 'Write' })
]

describe('subagentes na sessão', () => {
  it('cada agent_id vira um subagente trabalhando', () => {
    const s = run(parallel)
    expect(s.subs?.map((x) => [x.id, x.state])).toEqual([['ag-back', 'working'], ['ag-front', 'working']])
    expect(s.subs?.[0].tool).toBe('Write')
  })
  it('SubagentStop = concluído; calado 2 min = parou de responder', () => {
    let s = run([...parallel, ev('SubagentStop', 7, { agentId: 'ag-back', agentType: 'implementador' })])
    expect(s.subs?.find((x) => x.id === 'ag-back')?.state).toBe('done')
    s = tick(s, 7 + SUB_STALE_MS + 1)
    expect(s.subs?.find((x) => x.id === 'ag-front')?.state).toBe('stalled')
    expect(s.subs?.find((x) => x.id === 'ag-back')?.state).toBe('done')
  })
  it('estado da sessão do líder continua igual ao de antes', () => expect(run(parallel).state).toBe('WORKING'))
})

describe('subCount (contador no card de quem chamou)', () => {
  it('total e ativos', () => {
    const s = run([...parallel, ev('SubagentStop', 7, { agentId: 'ag-back', agentType: 'implementador' })])
    expect(subCount(s)).toEqual({ total: 2, active: 1 })
  })
  it('membros de Agent Team (por tipo) não contam como subagente', () => {
    const s = run([ev('SubagentStart', 1, { agentId: 'aback-1', agentType: 'back' }), ev('SubagentStart', 2, { agentId: 'x', agentType: 'Explore' })])
    expect(subCount(s, new Set(['back']))).toEqual({ total: 1, active: 1 })
  })
  it('sem sessão: zero', () => expect(subCount(undefined)).toEqual({ total: 0, active: 0 }))
})

describe('teams.json da versão anterior', () => {
  it('cards de subagente (subId) são soltos ao carregar', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pet-mig-')), 'teams.json')
    fs.writeFileSync(f, JSON.stringify({ teams: [{ id: 'equipe', name: 'equipe', goal: '', dismissed: ['x'], agents: [
      { role: 'lider', sessionId: 'lead0001', task: '', validated: false },
      { role: 'backend', sessionId: 'lead0001', subId: 'ag-back', task: 'Backend', validated: false }
    ] }] }))
    const st = new TeamStore(f, () => {})
    expect(st.teams[0].agents.map((a) => a.sessionId)).toEqual(['lead0001', undefined])
  })
})
