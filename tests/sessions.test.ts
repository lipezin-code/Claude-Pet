import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../src/main/sessions'

let dir: string
let alive: Set<number>
let t: number
const mk = () => new SessionManager(dir, (p) => alive.has(p), () => t)
const file = (pid: number, id: string, cwd = 'C:\\w\\proj') =>
  fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd, entrypoint: 'cli' }))

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-')); alive = new Set(); t = 1_000_000 })

describe('SessionManager', () => {
  it('descobre sessão aberta como UNKNOWN (sem inventar atividade)', () => {
    file(10, 's1'); alive.add(10)
    const m = mk(); m.discover()
    const s = m.sessions.get('s1')!
    expect(s.state).toBe('UNKNOWN'); expect(s.pid).toBe(10); expect(s.origin).toBe('cli'); expect(s.project).toBe('proj')
  })
  it('ignora arquivo de sessão com processo morto', () => {
    file(11, 's2')
    const m = mk(); m.discover(); expect(m.sessions.has('s2')).toBe(false)
  })
  it('eventos dão estado; processo morrendo encerra', () => {
    file(10, 's1'); alive.add(10)
    const m = mk(); m.discover()
    m.ingest({ sessionId: 's1', event: 'PreToolUse', tool: 'Bash', ts: t })
    expect(m.sessions.get('s1')!.state).toBe('WORKING')
    alive.delete(10); m.discover()
    expect(m.sessions.get('s1')!.liveness).toBe('ended')
  })
  it('sessões simultâneas', () => {
    file(10, 'a'); file(20, 'b'); alive.add(10); alive.add(20)
    const m = mk(); m.discover()
    m.ingest({ sessionId: 'a', event: 'Stop', ts: t }); m.ingest({ sessionId: 'b', event: 'PermissionRequest', ts: t })
    expect(m.list().map((s) => s.state).sort()).toEqual(['COMPLETED', 'WAITING_PERMISSION'])
  })
  it('reinício: restaurada vira UNKNOWN e é reconciliada', () => {
    file(10, 's1'); alive.add(10)
    const a = mk(); a.discover(); a.ingest({ sessionId: 's1', event: 'PreToolUse', ts: t })
    a.ingest({ sessionId: 'velha', event: 'Stop', ts: t })
    t += 60_000
    const b = mk(); b.restore(a.list())
    expect(b.sessions.get('s1')!.state).toBe('UNKNOWN')
    b.discover()
    expect(b.sessions.get('s1')!.liveness).not.toBe('ended')
    expect(b.sessions.get('velha')!.liveness).toBe('ended') // sem arquivo/processo
  })
  it('evento de sessão nunca vista cria a sessão (hooks em sessão nova)', () => {
    const m = mk(); m.ingest({ sessionId: 'novo', event: 'UserPromptSubmit', ts: t, cwd: 'C:\\a\\b' })
    expect(m.sessions.get('novo')!.state).toBe('THINKING')
  })
})
