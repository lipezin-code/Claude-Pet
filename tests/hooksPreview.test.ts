import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lineDiff } from '../src/shared/lineDiff'

describe('lineDiff', () => {
  it('só trechos alterados com contexto; + entra, - sai', () => {
    const d = lineDiff('a\nb\nc\nd\ne\nf\ng', 'a\nb\nc\nX\ne\nf\ng', 1)
    expect(d.text).toBe('…\n  c\n- d\n+ X\n  e\n…')
    expect(d.changes).toBe(2)
  })
  it('igual: vazio', () => expect(lineDiff('x', 'x')).toEqual({ text: '', changes: 0 }))
})

// ~/.claude falso: o settings.json real do usuário nunca é tocado
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-claude-'))
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-data-'))
const settings = path.join(dir, 'settings.json')
const hookSrc = path.resolve('hook/claude-pet-hook.cjs')
let old: string | undefined
beforeAll(() => { old = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = dir })
afterAll(() => { if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = old })

describe('instalar hooks: prévia, confirmação, sem sobrescrever terceiros', async () => {
  const { installHooks, previewHooks } = await import('../src/main/hooksInstall')
  const theirs = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'outro-hook.exe' }] }] }, model: 'opus' }

  it('prévia não grava nada e mostra o que entra', () => {
    fs.writeFileSync(settings, JSON.stringify(theirs))
    const before = fs.readFileSync(settings, 'utf8')
    const p = previewHooks(data)
    expect(fs.readFileSync(settings, 'utf8')).toBe(before)
    expect(p.changes).toBeGreaterThan(0)
    expect(p.diff).toContain('+ ')
    expect(p.diff).toContain('TeammateIdle')
    expect(p.diff).not.toMatch(/^- .*outro-hook/m) // hook de terceiro não sai
  })
  it('grava com o token da prévia: mantém o de terceiro e faz backup', () => {
    fs.writeFileSync(settings, JSON.stringify(theirs))
    const p = previewHooks(data)
    installHooks(data, hookSrc, p.token)
    const after = JSON.parse(fs.readFileSync(settings, 'utf8'))
    expect(JSON.stringify(after.hooks.Stop)).toContain('outro-hook.exe')
    expect(after.model).toBe('opus')
    expect(after.hooks.TeammateIdle).toBeDefined()
    expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeGreaterThan(0)
  })
  it('settings.json mudou depois da prévia: recusa e não grava', () => {
    fs.writeFileSync(settings, JSON.stringify(theirs))
    const p = previewHooks(data)
    fs.writeFileSync(settings, JSON.stringify({ ...theirs, model: 'sonnet' }))
    expect(() => installHooks(data, hookSrc, p.token)).toThrow(/mudou depois da prévia/)
    expect(JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.TeammateIdle).toBeUndefined()
  })
})
