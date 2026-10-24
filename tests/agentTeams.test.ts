import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { knownSubagentTypes, readAgentTeams } from '../src/main/agentTeams'
import { TeamStore } from '../src/main/teams'
import { memberSkins, memberStatus, parseTeamConfig, type AgentTeam } from '../src/shared/agentTeams'
import { applyEvent, newSession } from '../src/shared/machine'
import type { HookEvent, Session } from '../src/shared/types'

// mesmo formato do config.json real (Claude Code 2.1.310), com o campo `prompt` que nunca pode vazar
const LEAD = '22624737-97b1-4fe8-ad05-32914663daa0'
const real = {
  name: 'session-22624737', createdAt: 1, leadAgentId: 'team-lead@session-22624737', leadSessionId: LEAD,
  members: [
    { agentId: 'team-lead@session-22624737', name: 'team-lead', agentType: 'team-lead', joinedAt: 1, tmuxPaneId: 'leader', cwd: 'C:/t', subscriptions: [], backendType: 'in-process' },
    { agentId: 'back@session-22624737', name: 'back', color: 'blue', joinedAt: 2, tmuxPaneId: 'in-process', subscriptions: [], agentType: 'caveman:cavecrew-reviewer', model: 'haiku', prompt: 'PROMPT-SECRETO', planModeRequired: false, cwd: 'C:/t', backendType: 'in-process' },
    { agentId: 'front@session-22624737', name: 'front', color: 'green', joinedAt: 3, tmuxPaneId: 'in-process', subscriptions: [], agentType: 'caveman:cavecrew-reviewer', model: 'haiku', prompt: 'PROMPT-SECRETO', planModeRequired: false, cwd: 'C:/t', backendType: 'in-process' }
  ]
}

describe('parseTeamConfig', () => {
  it('liga pelo leadSessionId, tira o líder dos membros e nunca guarda o prompt', () => {
    const t = parseTeamConfig(JSON.stringify(real), 'session-22624737')!
    expect(t.leadSessionId).toBe(LEAD)
    expect(t.members.map((m) => [m.name, m.color])).toEqual([['back', 'blue'], ['front', 'green']])
    expect(JSON.stringify(t)).not.toContain('PROMPT-SECRETO')
  })
  it('tolerante: campos ausentes viram "desconhecido"; texto limitado; cor fora da lista fechada', () => {
    const t = parseTeamConfig(JSON.stringify({ leadSessionId: LEAD, members: [{}, { name: 'x'.repeat(500), color: 'red;background:url(x)' }, 7] }), 'pasta')!
    expect(t.id).toBe('pasta')
    expect(t.members[0]).toEqual({ name: 'desconhecido', agentType: 'desconhecido', color: 'desconhecido', joinedAt: 0 })
    expect(t.members[1].name.length).toBe(40)
    expect(t.members[1].color).toBe('desconhecido')
  })
  it('sem leadSessionId válido / JSON quebrado: ignora', () => {
    expect(parseTeamConfig('{', 'p')).toBeNull()
    expect(parseTeamConfig(JSON.stringify({ members: [] }), 'p')).toBeNull()
    expect(parseTeamConfig(JSON.stringify({ leadSessionId: '../../x' }), 'p')).toBeNull()
  })
})

const team = (x: Partial<AgentTeam> = {}): AgentTeam => ({ ...parseTeamConfig(JSON.stringify(real), 's')!, ambiguous: [], ended: false, seenAt: 0, ...x })
const ev = (event: string, ts: number, x: Partial<HookEvent> = {}): HookEvent => ({ sessionId: LEAD, event, ts, ...x })
const lead = (events: HookEvent[]) => events.reduce((s, e) => applyEvent(s, e), newSession(LEAD, 'C:/t', 0) as Session)

describe('memberStatus (eventos reais: agent_type = nome do membro)', () => {
  const s = lead([
    ev('SubagentStart', 1, { agentId: 'aback-f46', agentType: 'back' }),
    ev('PreToolUse', 2, { agentId: 'aback-f46', agentType: 'back', tool: 'Read' }),
    ev('SubagentStart', 3, { agentId: 'afront-c8d', agentType: 'front' }),
    ev('SubagentStop', 4, { agentId: 'afront-c8d', agentType: 'front' })
  ])
  const [back, front] = team().members
  it('trabalhando / concluído', () => {
    expect(memberStatus(team(), back, s)).toBe('working')
    expect(memberStatus(team(), front, s)).toBe('done')
  })
  it('nome igual a tipo de subagente => desconhecido (não assume)', () => expect(memberStatus(team({ ambiguous: ['back'] }), back, s)).toBe('unknown'))
  it('sem atividade ainda => aguardando; sem sessão do líder => desconhecido; pasta sumiu => encerrada', () => {
    expect(memberStatus(team(), back, lead([]))).toBe('waiting')
    expect(memberStatus(team(), back, undefined)).toBe('unknown')
    expect(memberStatus(team({ ended: true }), back, s)).toBe('ended')
  })
})

describe('memberSkins', () => {
  const ids = ['classico', 'azul', 'roxo', 'verde', 'dourado']
  it('cor do config vira skin parecida; sem repetir e sem pegar a do líder', () => {
    const m = memberSkins(team(), ids, 'dourado')
    expect([m.get('back'), m.get('front')]).toEqual(['azul', 'verde'])
    const same = memberSkins({ ...team(), members: team().members.map((x) => ({ ...x, color: 'yellow' })) }, ids, 'dourado')
    expect(new Set([same.get('back'), same.get('front'), 'dourado']).size).toBe(3)
  })
})

describe('leitura do disco (só leitura)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-at-'))
  const teams = path.join(root, 'teams')
  fs.mkdirSync(path.join(teams, 'session-22624737'), { recursive: true })
  fs.writeFileSync(path.join(teams, 'session-22624737', 'config.json'), JSON.stringify(real))
  fs.mkdirSync(path.join(teams, 'ruim')); fs.writeFileSync(path.join(teams, 'ruim', 'config.json'), '{{{')
  fs.mkdirSync(path.join(teams, 'vazia'))
  it('lê as válidas, ignora as ruins e não cria/altera nada', () => {
    const snap = () => fs.readdirSync(teams, { recursive: true }).map(String).sort().join('|')
    const before = snap()
    const logs: string[] = []
    const found = readAgentTeams(teams, (m) => logs.push(m))
    expect(found.map((t) => t.id)).toEqual(['session-22624737'])
    expect(logs.length).toBe(1)
    expect(snap()).toBe(before)
    expect(readAgentTeams(path.join(root, 'nao-existe'), () => {})).toEqual([])
  })
  it('tipos de subagente conhecidos: embutidos + ~/.claude/agents (nome do arquivo e do frontmatter)', () => {
    fs.mkdirSync(path.join(root, 'agents'))
    fs.writeFileSync(path.join(root, 'agents', 'revisor.md'), '---\nname: Security-Reviewer\n---\n')
    const k = knownSubagentTypes(root)
    expect(['explore', 'revisor', 'security-reviewer'].every((x) => k.has(x))).toBe(true)
  })
  it('TeamStore: só equipe de líder conhecido; pasta sumiu => encerrada', () => {
    const st = new TeamStore(path.join(root, 'teams-store.json'), () => {})
    const found = readAgentTeams(teams, () => {})
    expect(st.syncAgentTeams(found, new Set(['outra-sessao']), () => [])).toBe(false)
    expect(st.syncAgentTeams(found, new Set([LEAD]), () => [])).toBe(true)
    expect(st.syncAgentTeams(found, new Set([LEAD]), () => [])).toBe(false) // nada mudou: não regrava
    expect(st.syncAgentTeams([], new Set([LEAD]), () => [])).toBe(true)
    expect(st.agentTeams[0].ended).toBe(true)
  })
})

describe('TeammateIdle / TaskCreated / TaskCompleted', () => {
  const [back, front] = team().members
  it('TeammateIdle => aguardando (diferente de concluído e de parou de responder)', () => {
    const s = lead([ev('SubagentStart', 1, { agentId: 'aback-1', agentType: 'back' }), ev('TeammateIdle', 2, { teammate: 'back' })])
    expect(memberStatus(team(), back, s)).toBe('waiting')
    expect(lead([ev('TeammateIdle', 1, { teammate: 'front' })]).subs?.[0]).toMatchObject({ type: 'front', state: 'idle' })
  })
  it('TaskCreated dá a tarefa ao membro; TaskCompleted + ocioso => concluído', () => {
    let s = lead([ev('TaskCreated', 1, { teammate: 'front', taskId: 't1', taskSubject: 'Revisar README' })])
    expect(s.teamTasks?.front).toEqual({ subject: 'Revisar README', done: false })
    s = [ev('SubagentStart', 2, { agentId: 'afront-1', agentType: 'front' }), ev('TaskCompleted', 3, { teammate: 'front', taskId: 't1', taskSubject: 'Revisar README' }), ev('TeammateIdle', 4, { teammate: 'front' })]
      .reduce((x, e) => applyEvent(x, e), s)
    expect(memberStatus(team(), front, s)).toBe('done')
  })
  it('tarefa criada pelo líder sem dono não é atribuída a ninguém', () => {
    expect(lead([ev('TaskCreated', 1, { taskId: 't9', taskSubject: 'Geral' })]).teamTasks).toBeUndefined()
  })
  it('atividade nova depois de ocioso volta a trabalhando', () => {
    const s = lead([ev('SubagentStart', 1, { agentId: 'aback-1', agentType: 'back' }), ev('TeammateIdle', 2, { teammate: 'back' }), ev('PreToolUse', 3, { agentId: 'aback-1', agentType: 'back', tool: 'Read' })])
    expect(memberStatus(team(), back, s)).toBe('working')
  })
})

describe('remover equipes antigas', () => {
  it('remover tira do pet, não volta enquanto a pasta existir e não toca em ~/.claude/teams', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-rm-'))
    const tdir = path.join(root, 'teams', 'session-22624737')
    fs.mkdirSync(tdir, { recursive: true })
    fs.writeFileSync(path.join(tdir, 'config.json'), JSON.stringify(real))
    const st = new TeamStore(path.join(root, 'store.json'), () => {})
    const found = readAgentTeams(path.join(root, 'teams'), () => {})
    st.syncAgentTeams(found, new Set([LEAD]), () => [])
    expect(st.removeAgentTeams(['session-22624737'])).toBe(true)
    expect(st.agentTeams).toEqual([])
    expect(st.syncAgentTeams(found, new Set([LEAD]), () => [])).toBe(false) // não volta
    expect(fs.existsSync(path.join(tdir, 'config.json'))).toBe(true)
    expect(new TeamStore(path.join(root, 'store.json'), () => {}).agentTeams).toEqual([]) // persiste
  })
  it('líder encerrado => equipe encerrada mesmo com a pasta ainda lá', () => {
    const s = { ...lead([]), liveness: 'ended' as const }
    expect(memberStatus(team(), team().members[0], s)).toBe('ended')
  })
})
