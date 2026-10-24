import { describe, expect, it } from 'vitest'
import { applyEvent, newSession, pickDisplay, tick, COMPLETED_HOLD_MS, STALE_MS } from '../src/shared/machine'
import type { HookEvent } from '../src/shared/types'

const ev = (event: string, ts: number, extra: Partial<HookEvent> = {}): HookEvent => ({ sessionId: 's1', event, ts, cwd: 'C:\\x\\proj', ...extra })

describe('machine', () => {
  it('fluxo normal prompt->tool->stop', () => {
    let s = newSession('s1')
    s = applyEvent(s, ev('UserPromptSubmit', 1)); expect(s.state).toBe('THINKING')
    s = applyEvent(s, ev('PreToolUse', 2, { tool: 'Bash' })); expect(s.state).toBe('WORKING'); expect(s.tool).toBe('Bash')
    s = applyEvent(s, ev('PostToolUse', 3)); expect(s.state).toBe('THINKING')
    s = applyEvent(s, ev('Stop', 4)); expect(s.state).toBe('COMPLETED'); expect(s.liveness).toBe('active')
    expect(s.project).toBe('proj')
  })
  it('Stop não encerra; SessionEnd encerra', () => {
    let s = applyEvent(newSession('s1'), ev('Stop', 1))
    expect(s.liveness).toBe('active')
    s = applyEvent(s, ev('SessionEnd', 2)); expect(s.liveness).toBe('ended'); expect(s.state).toBe('DISCONNECTED')
  })
  it('Notification só vira permissão quando permission_prompt', () => {
    let s = applyEvent(newSession('s1'), ev('PreToolUse', 1, { tool: 'Edit' }))
    s = applyEvent(s, ev('Notification', 2, { notificationType: 'auth_success', message: 'ok' }))
    expect(s.state).toBe('WORKING')
    s = applyEvent(s, ev('Notification', 3, { notificationType: 'permission_prompt' }))
    expect(s.state).toBe('WAITING_PERMISSION')
    s = applyEvent(s, ev('PostToolUse', 4)); expect(s.state).toBe('THINKING')
  })
  it('StopFailure => ERROR com motivo', () => {
    const s = applyEvent(newSession('s1'), ev('StopFailure', 1, { error: 'rate_limit' }))
    expect(s.state).toBe('ERROR'); expect(s.note).toBe('rate_limit')
  })
  it('subagentes nunca negativos', () => {
    let s = applyEvent(newSession('s1'), ev('SubagentStop', 1)); expect(s.subagents).toBe(0)
    s = applyEvent(s, ev('SubagentStart', 2)); expect(s.subagents).toBe(1)
  })
  it('tick: COMPLETED decai; WORKING sem evidência vira UNKNOWN', () => {
    let s = applyEvent(newSession('s1'), ev('Stop', 1000))
    expect(tick(s, 1000 + COMPLETED_HOLD_MS + 1).state).toBe('IDLE')
    s = applyEvent(newSession('s1'), ev('PreToolUse', 1000, { tool: 'Bash' }))
    expect(tick(s, 1000 + STALE_MS - 1).state).toBe('WORKING')
    const u = tick(s, 1000 + STALE_MS + 1)
    expect(u.state).toBe('UNKNOWN'); expect(u.note).toBe('Aguardando eventos')
  })
  it('sessão só descoberta fica UNKNOWN (não inventa atividade)', () => {
    expect(tick(newSession('s1'), 9e9).state).toBe('UNKNOWN')
  })
  it('política: permissão vence; manual vence política; ended ignorada', () => {
    const a = applyEvent(newSession('a'), { ...ev('PreToolUse', 5, { tool: 'Bash' }), sessionId: 'a' })
    const b = applyEvent(newSession('b'), { ...ev('PermissionRequest', 1), sessionId: 'b' })
    const c = applyEvent(applyEvent(newSession('c'), { ...ev('Stop', 9), sessionId: 'c' }), { ...ev('SessionEnd', 10), sessionId: 'c' })
    expect(pickDisplay([a, b, c], { policy: 'attention', watchedSessionId: null }).sessionId).toBe('b')
    expect(pickDisplay([a, b, c], { policy: 'recent', watchedSessionId: null }).sessionId).toBe('a')
    expect(pickDisplay([a, b, c], { policy: 'attention', watchedSessionId: 'a' }).sessionId).toBe('a')
    expect(pickDisplay([c], { policy: 'attention', watchedSessionId: null }).state).toBe('DISCONNECTED')
  })
})
