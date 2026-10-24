import { describe, expect, it } from 'vitest'
import { assignSkins, buildRoster, migrateAgent, migrateTeamSkins, slotSkins, slugify, swapSkin } from '../src/shared/teams'

const SK = ['classico', 'azul', 'roxo', 'verde', 'rosa', 'dourado']
const items = (skins: (string | undefined)[]) => skins.map((skinId, i) => ({ id: `a${i}`, skinId }))
const distinct = (m: Map<string, string>) => new Set(m.values()).size === m.size

describe('assignSkins', () => {
  it('dá skins diferentes na ordem', () => {
    expect([...assignSkins(items([undefined, undefined, undefined]), SK).values()]).toEqual(['classico', 'azul', 'roxo'])
  })
  it('escolha duplicada ou inexistente vira automática', () => {
    const m = assignSkins(items(['azul', 'azul', 'sumiu']), SK)
    expect(m.get('a0')).toBe('azul')
    expect(distinct(m)).toBe(true)
  })
  it('mais itens que skins: todos recebem alguma', () => {
    expect(assignSkins(items([undefined, undefined, undefined]), ['a', 'b']).size).toBe(3)
  })
})

describe('skins por posição do card', () => {
  const SK7 = [...SK, 'rosa2', 'dark', 'branco']
  it('padrão: líder dourado, demais sem repetir', () => {
    const m = slotSkins({}, SK7)
    expect(m.get('lider')).toBe('dourado')
    expect(distinct(m)).toBe(true)
  })
  it('dourado escolhido para outra posição: líder não repete', () => {
    const m = slotSkins({ a1: 'dourado' }, SK7)
    expect(m.get('a1')).toBe('dourado')
    expect(m.get('lider')).not.toBe('dourado')
  })
  it('troca com a posição dona da skin', () => {
    const before = slotSkins({}, SK7)
    const after = swapSkin({}, 'a3', 'dourado', SK7)
    expect(after.a3).toBe('dourado')
    expect(after.lider).toBe(before.get('a3'))
    expect(new Set(Object.values(after)).size).toBe(8)
  })
  it('settings antigo (por função) vira por posição', () => {
    expect(migrateTeamSkins({ lider: 'dourado', backend: 'azul', revisao: 'verde', x: 'y' })).toEqual({ lider: 'dourado', a1: 'azul', a4: 'verde' })
  })
})

describe('montar equipe (slug e validação)', () => {
  it('slug: sem acento, minúsculas, hífen; nada perigoso para branch/pasta', () => {
    expect(slugify('Integrações/API')).toBe('integracoes-api')
    expect(slugify('  Back-end  ')).toBe('back-end')
    expect(slugify('../../x; rm -rf')).toBe('x-rm-rf')
    expect(slugify('!!!')).toBe('')
    expect(slugify('a'.repeat(50)).length).toBe(30)
  })
  it('agentes mantêm a posição; novos pegam a 1ª livre; líder sempre primeiro', () => {
    const r = buildRoster([{ id: 'a2', kind: 'frontend', label: 'Front-end' }, { kind: 'custom', label: 'Documentação' }])
    expect(r.ok && r.agents.map((a) => [a.id, a.slug])).toEqual([['lider', 'lider'], ['a2', 'front-end'], ['a1', 'documentacao']])
  })
  it('recusa: vazio, sem letras, repetido, reservado, 0 ou mais de 7', () => {
    expect(buildRoster([]).ok).toBe(false)
    expect(buildRoster([{ kind: 'custom', label: '' }]).ok).toBe(false)
    expect(buildRoster([{ kind: 'custom', label: '###' }]).ok).toBe(false)
    expect(buildRoster([{ kind: 'backend', label: 'Back-end' }, { kind: 'custom', label: 'back END' }])).toMatchObject({ ok: false, row: 1 })
    expect(buildRoster([{ kind: 'custom', label: 'Main' }]).ok).toBe(false)
    expect(buildRoster(Array.from({ length: 8 }, (_, i) => ({ kind: 'custom' as const, label: `x${i}` }))).ok).toBe(false)
  })
  it('migração: função fixa antiga vira posição + função; Revisão vira Personalizada', () => {
    expect(migrateAgent({ role: 'revisao', task: 't', validated: true, sessionId: 's0000001', worktree: { path: 'C:/p' } }))
      .toEqual({ id: 'a4', kind: 'custom', label: 'Revisão', slug: 'revisao', sessionId: 's0000001', worktree: { path: 'C:/p' } })
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agentStatus, autoBind, newTeam, type Team } from '../src/shared/teams'
import { newSession } from '../src/shared/machine'
import { skinBitmap, TeamStore } from '../src/main/teams'
import { CLASSICO } from '../src/shared/skins'
import type { PetState, Session } from '../src/shared/types'

const ses = (id: string, state: PetState, events: string[], extra: Partial<Session> = {}): Session => ({
  ...newSession(id, 'C:/p/wt-back', 1), state, liveness: 'active', lastEventAt: 10,
  log: events.map((event, i) => ({ ts: i + 1, event })), ...extra
})

describe('agentStatus', () => {
  it('sem sessão', () => expect(agentStatus(undefined, false)).toBe('unbound'))
  it('trabalhando e precisa de você', () => {
    expect(agentStatus(ses('s1', 'WORKING', ['PreToolUse']), false)).toBe('working')
    expect(agentStatus(ses('s1', 'WAITING_PERMISSION', ['PermissionRequest']), false)).toBe('needs_you')
  })
  it('parou de responder = calou no meio de uma resposta', () => {
    expect(agentStatus(ses('s1', 'UNKNOWN', ['UserPromptSubmit', 'PreToolUse', 'Notification']), false)).toBe('stalled')
  })
  it('UNKNOWN depois de concluir NÃO é parou de responder (ex.: pet reiniciado)', () => {
    expect(agentStatus(ses('s1', 'UNKNOWN', ['PreToolUse', 'Stop', 'Notification']), false)).toBe('done')
    expect(agentStatus(ses('s1', 'UNKNOWN', []), false)).toBe('waiting')
  })
  it('validada é diferente de parou de responder e de concluída', () => {
    expect(agentStatus(ses('s1', 'UNKNOWN', ['PreToolUse']), true)).toBe('validated')
    expect(agentStatus(ses('s1', 'IDLE', ['Stop']), true)).toBe('validated')
    expect(agentStatus(ses('s1', 'DISCONNECTED', ['Stop'], { liveness: 'ended' }), true)).toBe('validated')
  })
  it('atividade nova vence a validação', () => expect(agentStatus(ses('s1', 'WORKING', ['PreToolUse']), true)).toBe('working'))
  it('encerrada', () => expect(agentStatus(ses('s1', 'DISCONNECTED', ['SessionEnd'], { liveness: 'ended' }), false)).toBe('ended'))
})

describe('autoBind (pasta do worktree)', () => {
  const team = (): Team[] => [{ ...newTeam(), agents: [{ id: 'a1', kind: 'backend', label: 'Back-end', slug: 'back-end', sessionId: 'old00000', worktree: { path: 'C:/p/wt-back' } }] }]
  it('sessão nova na pasta do agente substitui a encerrada', () => {
    const r = autoBind(team(), [ses('old00000', 'DISCONNECTED', [], { liveness: 'ended' }), ses('new00000', 'IDLE', [], { cwd: 'c:/p/WT-BACK/' })])
    expect(r?.[0].agents[0].sessionId).toBe('new00000')
  })
  it('duas sessões na mesma pasta = ambíguo, não mexe', () => {
    expect(autoBind(team(), [ses('a0000000', 'IDLE', []), ses('b0000000', 'IDLE', [])])).toBeNull()
  })
  it('sessão atual viva: não mexe', () => {
    expect(autoBind(team(), [ses('old00000', 'IDLE', []), ses('new00000', 'IDLE', [])])).toBeNull()
  })
})

describe('TeamStore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-teams-'))
  it('arquivo inválido é preservado como .invalid e começa vazio', () => {
    const f = path.join(dir, 'teams.json')
    fs.writeFileSync(f, JSON.stringify({ teams: [{ id: '../x', name: 'a b' }] }))
    const st = new TeamStore(f, () => {})
    expect(st.teams).toEqual([])
    expect(fs.existsSync(f + '.invalid')).toBe(true)
  })
  it('vincular move a sessão de outro agente e grava em disco', () => {
    const f = path.join(dir, 'ok.json')
    const st = new TeamStore(f, () => {})
    st.bind('a1', { id: 's0000001', cwd: 'C:/p' })
    st.bind('a2', { id: 's0000001', cwd: 'C:/p' })
    const saved = JSON.parse(fs.readFileSync(f, 'utf8')).teams[0].agents
    expect(saved.find((a: any) => a.id === 'a1').sessionId).toBeUndefined()
    expect(saved.find((a: any) => a.id === 'a2').sessionId).toBe('s0000001')
  })
  it('editar a equipe: quem fica mantém sessão; trocar a função mantém a posição (e a skin)', () => {
    const st = new TeamStore(path.join(dir, 'roster.json'), () => {})
    st.bind('a1', { id: 's0000002', cwd: 'C:/p' })
    st.setRoster([{ id: 'a1', kind: 'banco', label: 'Banco de dados' }])
    expect(st.teams[0].agents.map((a) => [a.id, a.slug, a.sessionId])).toEqual([['lider', 'lider', undefined], ['a1', 'banco-de-dados', 's0000002']])
    expect(() => st.setRoster([])).toThrow()
  })
  it('teams.json da versão de funções fixas carrega sem perder sessões', () => {
    const f = path.join(dir, 'old.json')
    fs.writeFileSync(f, JSON.stringify({ teams: [{ id: 'equipe', name: 'equipe', goal: '', agents: [
      { role: 'lider', task: '', validated: false, sessionId: 'lead0001' }, { role: 'backend', task: 'x', validated: false, sessionId: 'back0001' }
    ] }] }))
    const st = new TeamStore(f, () => {})
    expect(st.teams[0].agents.map((a) => [a.id, a.label, a.sessionId])).toEqual([['lider', 'Líder', 'lead0001'], ['a1', 'Back-end', 'back0001']])
  })
})

describe('skinBitmap', () => {
  it('quadrado BGRA com corpo na cor da skin', () => {
    const { buf, size } = skinBitmap(CLASSICO, 1)
    expect(size).toBe(16)
    expect(buf.length).toBe(16 * 16 * 4)
    const o = ((2 + 1) * 16 + 2) * 4 // linha 2 da grade (+1 de margem), coluna 2 = corpo
    expect([buf[o + 2], buf[o + 1], buf[o]]).toEqual([0xe8, 0x74, 0x3b])
  })
})
