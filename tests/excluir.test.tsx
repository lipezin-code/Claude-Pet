import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { dropConvs } from '../src/main/chat'
import { SessionManager } from '../src/main/sessions'
import { Sessions } from '../src/renderer/Sessions'
import { KnownSessions } from '../src/renderer/Settings'
import { CLASSICO } from '../src/shared/skins'
import { DEFAULT_SETTINGS, type AppSnapshot, type Session } from '../src/shared/types'

const sess = (id: string, project: string, liveness: Session['liveness']): Session =>
  ({ id, cwd: `C:\\p\\${project}`, project, state: 'IDLE', stateSince: 0, lastEventAt: 1, origin: 'cli', liveness, pinned: false, subagents: 0, log: [] })

describe('SessionManager.forget', () => {
  it('tira encerrada e desconhecida, recusa ativa, e o discover não traz de volta', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-'))
    fs.writeFileSync(path.join(dir, '10.json'), JSON.stringify({ pid: 10, sessionId: 'velha-aaaa', cwd: 'C:\\w\\x', entrypoint: 'cli' })) // processo morto
    const m = new SessionManager(dir, () => false, () => 1_000_000)
    for (const s of [sess('velha-aaaa', 'x', 'ended'), sess('quem-sabe', 'x', 'unknown'), sess('viva-aaaa', 'y', 'active')]) m.sessions.set(s.id, s)
    expect(m.forget(['velha-aaaa', 'quem-sabe', 'viva-aaaa', 'nao-existe'])).toEqual(['velha-aaaa', 'quem-sabe'])
    m.discover()
    expect([...m.sessions.keys()]).toEqual(['viva-aaaa'])
  })
})

describe('sessões não acumulam', () => {
  it('restore mantém encerrada como encerrada, com o horário original (prune de 24 h funciona entre aberturas)', () => {
    const m = new SessionManager(fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')), () => false, () => 100 * 3600_000)
    m.restore([{ ...sess('velha-aaaa', 'x', 'ended'), stateSince: 1 }, sess('quem-sabe', 'x', 'active')])
    expect(m.sessions.get('velha-aaaa')).toMatchObject({ liveness: 'ended', stateSince: 1 })
    expect(m.sessions.get('quem-sabe')!.liveness).toBe('unknown')
    m.prune()
    expect(m.sessions.has('velha-aaaa')).toBe(false)
  })
  it('sessão do mini chat: fica viva enquanto responde e encerra depois (antes ficava "desconhecida" para sempre)', () => {
    let t = 1_000_000
    const m = new SessionManager(fs.mkdtempSync(path.join(os.tmpdir(), 'ch-')), () => false, () => t)
    m.markChat('conv-sess-1', 'C:\\w\\x')
    t += 60_000; m.discover()
    expect(m.sessions.get('conv-sess-1')!.liveness).not.toBe('ended') // respondendo
    m.chatDone('conv-sess-1')
    m.discover()
    expect(m.sessions.get('conv-sess-1')!.liveness).toBe('ended')
  })
})

describe('dropConvs', () => {
  it('exclui em lote, menos a que está respondendo', () => {
    const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(dropConvs(l, ['a', 'b', 'zz'], new Set(['b']))).toEqual([{ id: 'b' }, { id: 'c' }])
  })
})

describe('aba Sessões: filtro de projetos', () => {
  const snap = (sessions: Session[]): AppSnapshot => ({
    settings: DEFAULT_SETTINGS, skin: CLASSICO, display: { state: 'IDLE', sessionId: null, label: '' }, sessions,
    hooks: { installed: true, events: [], settingsPath: '' }, usage: { account: null, sessions: {} }, statusBridge: 'installed',
    cli: { found: true }, projects: [], envMarkers: [], teams: [], agentTeams: [], manualProject: null, version: 't'
  })
  it('com "ocultar encerradas", projeto só com encerradas não aparece no filtro (antes: lista vazia)', () => {
    const h = renderToStaticMarkup(<Sessions snap={snap([sess('a1234567', 'ativo', 'active'), sess('b1234567', 'antigo', 'ended'), sess('c1234567', 'antigo', 'ended')])} />)
    expect(h).toContain('ativo (1)')
    expect(h).not.toContain('antigo (')
    expect(h).toContain('Todos os projetos (1)')
    expect(h).toContain('Excluir encerradas (2)')
  })
  it('card "Sessões conhecidas" das Configurações: rótulos em português e botão com contagem', () => {
    const h = renderToStaticMarkup(<KnownSessions snap={snap([sess('a1234567', 'ativo', 'active'), sess('b1234567', 'antigo', 'ended'), sess('c1234567', 'outro', 'ended')])} />)
    expect(h).toContain('antigo · encerrada · CLI')
    expect(h).toContain('Excluir encerradas (2)')
    expect(h).not.toContain('DISCONNECTED')
  })
  it('sem encerradas, não mostra o botão de excluir', () => {
    expect(renderToStaticMarkup(<Sessions snap={snap([sess('a1234567', 'ativo', 'active')])} />)).not.toContain('Excluir encerradas')
  })
})
