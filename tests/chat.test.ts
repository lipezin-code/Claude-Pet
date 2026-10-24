import { describe, expect, it } from 'vitest'
import { assistantText, mapMessage, runCli } from '../src/main/chat'
import { buildClaudeArgs, validateCwd } from '../src/main/claudeCli'
import { redact } from '../src/main/store'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('chat stream mapping', () => {
  it('delta de texto', () => {
    expect(mapMessage({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'oi' } } })).toEqual([{ kind: 'delta', text: 'oi' }])
  })
  it('ignora deltas de subagente e de ferramentas', () => {
    expect(mapMessage({ type: 'stream_event', parent_tool_use_id: 'x', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } })).toEqual([])
    expect(mapMessage({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } } })).toEqual([])
  })
  it('result de erro', () => {
    const c = mapMessage({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's', errors: ['boom'] })
    expect(c).toContainEqual({ kind: 'result', isError: true, text: 'boom' })
  })
  it('assistantText', () => {
    expect(assistantText({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }] } })).toBe('ab')
  })
})

describe('runCli com processo falso', () => {
  it('streaming + sessão + prompt via stdin; cancelamento', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-'))
    const js = path.join(dir, 'fake.js')
    fs.writeFileSync(js, `let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{
      const o=(x)=>console.log(JSON.stringify(x));
      require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'argv.json'))},JSON.stringify(process.argv.slice(2)));
      require('fs').writeFileSync(${JSON.stringify(path.join(dir, 'env.json'))},JSON.stringify(Object.keys(process.env)));
      o({type:'system',subtype:'init',session_id:'sess-12345678'});
      o({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'eco:'+b}}});
      o({type:'result',subtype:'success',is_error:false,session_id:'sess-12345678',result:'x'})})`)
    const bat = path.join(dir, 'fake.cmd')
    fs.writeFileSync(bat, `@node "${js}" %*\r\n`)
    const chunks: any[] = []
    const saved = { a: process.env.CLAUDECODE, b: process.env.CLAUDE_CODE_CHILD_SESSION }
    process.env.CLAUDECODE = '1'; process.env.CLAUDE_CODE_CHILD_SESSION = '1' // pet "contaminado"
    try { await runCli(process.execPath, { prompt: 'olá', cwd: dir, signal: new AbortController().signal, onChunk: (c) => chunks.push(c) }, [js]) }
    finally {
      for (const [k, v] of [['CLAUDECODE', saved.a], ['CLAUDE_CODE_CHILD_SESSION', saved.b]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
    const childEnv: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8')).map((k: string) => k.toUpperCase())
    expect(childEnv).not.toContain('CLAUDECODE')
    expect(childEnv).not.toContain('CLAUDE_CODE_CHILD_SESSION')
    expect(childEnv).toContain('PATH')
    expect(chunks).toContainEqual({ kind: 'delta', text: 'eco:olá' })
    expect(chunks).toContainEqual({ kind: 'session', id: 'sess-12345678' })
    expect(chunks.at(-1)).toMatchObject({ kind: 'result', isError: false })
    const argv: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8')) // chat sem ferramentas nem MCP
    const i = argv.indexOf('--tools')
    expect(argv.slice(i, i + 2)).toEqual(['--tools', ''])
    expect(argv).toContain('--strict-mcp-config')
    expect(argv).not.toContain('--permission-mode')
  })
  it('falha ao iniciar vira erro, não exceção', async () => {
    const chunks: any[] = []
    await runCli('C:\\nao\\existe.exe', { prompt: 'x', cwd: os.tmpdir(), signal: new AbortController().signal, onChunk: (c) => chunks.push(c) })
    expect(chunks.at(-1)).toMatchObject({ kind: 'result', isError: true })
  })
})

describe('segurança', () => {
  it('validateCwd recusa metacaracteres e pasta inexistente', () => {
    expect(validateCwd('C:\\a;calc')).toBeTruthy()
    expect(validateCwd('C:\\a&calc')).toBeTruthy()
    expect(validateCwd('C:\\nao\\existe\\xyz')).toBeTruthy()
    expect(validateCwd(os.tmpdir())).toBeNull()
  })
  it('pasta com espaços é aceita', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'com espaço ')); expect(validateCwd(d)).toBeNull()
  })
  it('args de resume', () => { expect(buildClaudeArgs('abc-12345678')).toEqual(['--resume', 'abc-12345678']); expect(buildClaudeArgs()).toEqual([]) })
  it('redact esconde chaves', () => {
    expect(redact('key sk-ant-api03-ABCDEFGH123 e Bearer abcdef123456')).not.toMatch(/ABCDEFGH|abcdef123456/)
  })
})
