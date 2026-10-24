import { describe, expect, it } from 'vitest'
import { HOOK_EVENTS, installedEvents, mergeHooks, removeHooks } from '../src/shared/hooksConfig'

const theirs = { type: 'command', command: 'echo outro-app' }
const base = { model: 'opus', hooks: { Stop: [{ hooks: [theirs] }], PreToolUse: [{ matcher: 'Bash', hooks: [theirs] }] } }

describe('hooksConfig', () => {
  it('preserva hooks existentes e adiciona os nossos', () => {
    const m = mergeHooks(base, 'C:\\node.exe', 'C:\\x\\claude-pet-hook.cjs')
    expect(m.model).toBe('opus')
    expect(m.hooks.Stop[0].hooks[0]).toEqual(theirs)
    expect(m.hooks.Stop).toHaveLength(2)
    expect(installedEvents(m)).toHaveLength(HOOK_EVENTS.length)
    expect(base.hooks.Stop).toHaveLength(1) // não mutou o original
  })
  it('idempotente', () => {
    const a = mergeHooks(base, 'n', 's/claude-pet-hook.cjs')
    expect(mergeHooks(a, 'n', 's/claude-pet-hook.cjs')).toEqual(a)
  })
  it('remoção devolve exatamente o original', () => {
    const a = mergeHooks(base, 'n', 's/claude-pet-hook.cjs')
    expect(removeHooks(a)).toEqual(base)
  })
  it('remove chave hooks quando só havia os nossos', () => {
    const a = mergeHooks({ x: 1 }, 'n', 's/claude-pet-hook.cjs')
    expect(removeHooks(a)).toEqual({ x: 1 })
  })
})
