import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEventServer } from '../src/main/server'
import type { HookEvent } from '../src/shared/types'

const got: HookEvent[] = []
const srv = createEventServer('tok123', (e) => got.push(e))
let port = 0
beforeAll(async () => { port = await srv.listen() })
afterAll(() => { srv.server.close() })

const post = (body: unknown, token = 'tok123', path = '/event') =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('event server', () => {
  it('aceita evento válido', async () => {
    const r = await post({ session_id: 'abc-123', hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: 'C:\\p' })
    expect(r.status).toBe(204)
    expect(got[0]).toMatchObject({ sessionId: 'abc-123', event: 'PreToolUse', tool: 'Bash' })
  })
  it('rejeita sem token / token errado', async () => {
    expect((await post({ session_id: 'a', hook_event_name: 'Stop' }, 'ruim')).status).toBe(401)
    expect((await fetch(`http://127.0.0.1:${port}/event`, { method: 'POST', body: '{}' })).status).toBe(401)
  })
  it('rejeita session_id malicioso e JSON inválido', async () => {
    expect((await post({ session_id: '../../etc', hook_event_name: 'Stop' })).status).toBe(400)
    expect((await post('{nao-json')).status).toBe(400)
  })
  it('rejeita corpo gigante', async () => {
    const r = await post({ session_id: 'a', hook_event_name: 'Stop', message: 'x'.repeat(100_000) }).catch(() => ({ status: 413 }))
    expect([400, 413]).toContain(r.status)
  })
  it('só escuta em loopback', () => {
    expect((srv.server.address() as { address: string }).address).toBe('127.0.0.1')
  })
})
