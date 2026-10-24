import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bridgeStatus, installStatusBridge, removeStatusBridge, settingsPath } from '../src/main/hooksInstall'
import { createEventServer } from '../src/main/server'
import { bridgeCommand, isOurStatusLine } from '../src/shared/statuslineConfig'

const BRIDGE = path.join(__dirname, '..', 'hook', 'claude-pet-statusline.cjs')
let tmp: string, dataDir: string
const oldCfg = process.env.CLAUDE_CONFIG_DIR
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-sl-'))
  dataDir = path.join(tmp, 'ClaudePet')
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude') // nunca o ~/.claude real
})
afterEach(() => { if (oldCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = oldCfg })
const put = (text: string) => { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), text) }
const read = () => fs.readFileSync(settingsPath(), 'utf8')
const json = () => JSON.parse(read())

describe('instalador da faixa de uso', () => {
  const ORIGINAL = '{\n    "model": "opus",\n  "hooks": {"Stop": []}\n}' // formatação esquisita de propósito (restauração byte a byte)

  it('sem statusLine: instala, status "Instalada"; remoção restaura byte a byte', () => {
    put(ORIGINAL)
    expect(installStatusBridge(dataDir, BRIDGE, false)).toBe('installed')
    expect(isOurStatusLine(json().statusLine)).toBe(true)
    expect(json().model).toBe('opus') // resto preservado
    expect(fs.readdirSync(path.join(tmp, 'claude', 'backups')).length).toBe(1)
    expect(fs.existsSync(path.join(dataDir, 'hook', 'claude-pet-statusline.cjs'))).toBe(true)
    expect(removeStatusBridge(dataDir)).toBe('restored')
    expect(read()).toBe(ORIGINAL)
    expect(bridgeStatus(dataDir)).toBe('not_installed')
  })

  it('sem settings.json: remoção volta a não existir', () => {
    installStatusBridge(dataDir, BRIDGE, false)
    expect(removeStatusBridge(dataDir)).toBe('restored')
    expect(fs.existsSync(settingsPath())).toBe(false)
  })

  it('statusLine existente: encadeia (comando original fica só na config do pet) e restaura', () => {
    const orig = { type: 'command', command: 'bash ~/minha-statusline.sh', padding: 1 }
    put(JSON.stringify({ statusLine: orig }, null, 2))
    expect(installStatusBridge(dataDir, BRIDGE, false)).toBe('chained')
    expect(json().statusLine.padding).toBe(1)
    expect(read()).not.toContain('minha-statusline') // o settings.json não guarda o original
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'statusline.json'), 'utf8'))
    expect(cfg.chain).toBe(orig.command)
    // reinstalar sem mudanças não perde o original nem a restauração byte a byte
    expect(installStatusBridge(dataDir, BRIDGE, false)).toBe('chained')
    expect(removeStatusBridge(dataDir)).toBe('restored')
    expect(read()).toBe(JSON.stringify({ statusLine: orig }, null, 2))
  })

  it('reinstalar depois de mudança externa: original preservado, restaura só o campo', () => {
    const orig = { type: 'command', command: 'echo x' }
    put(JSON.stringify({ statusLine: orig }))
    installStatusBridge(dataDir, BRIDGE, false)
    put(JSON.stringify({ ...json(), theme: 'light' }))
    installStatusBridge(dataDir, BRIDGE, false)
    expect(removeStatusBridge(dataDir)).toBe('field')
    expect(json()).toEqual({ statusLine: orig, theme: 'light' })
  })

  it('outras chaves mudaram depois: restaura só o campo e mantém as mudanças', () => {
    put(ORIGINAL)
    installStatusBridge(dataDir, BRIDGE, false)
    put(JSON.stringify({ ...json(), theme: 'dark' }))
    expect(removeStatusBridge(dataDir)).toBe('field')
    expect(json()).toEqual({ model: 'opus', hooks: { Stop: [] }, theme: 'dark' })
  })

  it('statusLine trocada depois da instalação: não escreve nada, pede decisão', () => {
    put('{}')
    installStatusBridge(dataDir, BRIDGE, false)
    const changed = JSON.stringify({ statusLine: { type: 'command', command: 'outra' } })
    put(changed)
    expect(bridgeStatus(dataDir)).toBe('conflict')
    expect(removeStatusBridge(dataDir)).toBe('conflict')
    expect(read()).toBe(changed)
    expect(removeStatusBridge(dataDir, true)).toBe('released') // "só desligar no pet"
    expect(read()).toBe(changed)
    expect(bridgeStatus(dataDir)).toBe('not_installed')
  })

  it('settings.json inválido: aborta sem escrever nem fazer backup', () => {
    put('{ "model": "opus", ')
    expect(() => installStatusBridge(dataDir, BRIDGE, false)).toThrow(/não é JSON válido/)
    expect(read()).toBe('{ "model": "opus", ')
    expect(fs.existsSync(path.join(tmp, 'claude', 'backups'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'statusline.json'))).toBe(false)
    expect(bridgeStatus(dataDir)).toBe('unreadable')
  })

  it('aceita BOM (Notepad/PowerShell) e remove nada quando não há instalação', () => {
    put('\ufeff{"a":1}')
    expect(removeStatusBridge(dataDir)).toBe('nothing')
    expect(read()).toBe('\ufeff{"a":1}')
  })

  it('comando usa barras normais e aspas (Git Bash e cmd)', () => {
    expect(bridgeCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\x\\claude-pet-statusline.cjs')).toBe('"C:/Program Files/nodejs/node.exe" "C:/x/claude-pet-statusline.cjs"')
  })
})

// ---------- ponte (processo real) ----------
const INPUT = JSON.stringify({
  session_id: 'abc-123', transcript_path: 'C:\\segredo\\t.jsonl', cwd: 'C:\\segredo', model: { display_name: 'Opus' }, cost: { total_cost_usd: 1 },
  context_window: { used_percentage: 6, context_window_size: 1_000_000, total_input_tokens: 5, current_usage: { input_tokens: 2, output_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 } },
  rate_limits: { five_hour: { used_percentage: 94, resets_at: Math.floor(Date.now() / 1000) + 3600 }, seven_day: { used_percentage: 70, resets_at: Math.floor(Date.now() / 1000) + 86_400 } }
})
function runBridge(appdata: string, env: Record<string, string | undefined> = {}, input = INPUT): Promise<{ out: Buffer; err: string; code: number | null; ms: number }> {
  return new Promise((resolve) => {
    const t = Date.now()
    const p = spawn(process.execPath, [BRIDGE], { env: { ...process.env, APPDATA: appdata, SHELL: undefined, ...env } })
    const out: Buffer[] = []; let err = ''
    p.stdout.on('data', (c) => out.push(c)); p.stderr.on('data', (c) => { err += c })
    p.on('close', (code) => resolve({ out: Buffer.concat(out), err, code, ms: Date.now() - t }))
    p.stdin.end(input)
  })
}
const cfg = (appdata: string, c: object) => { fs.mkdirSync(path.join(appdata, 'ClaudePet'), { recursive: true }); fs.writeFileSync(path.join(appdata, 'ClaudePet', 'statusline.json'), JSON.stringify(c)) }
const gitBash = (() => { try { return execFileSync('where.exe', ['bash'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /git/i.test(l)) } catch { return undefined } })()

describe('ponte da status line', () => {
  const bodies: string[] = []
  let port = 0
  const srv = createEventServer('tok-ponte', () => {}, () => {})
  srv.server.prependListener('request', (req) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => bodies.push(b)) })
  beforeAll(async () => { port = await srv.listen() })
  afterAll(() => { srv.server.close() })

  it('pet fechado: silenciosa, exit 0, rápida', async () => {
    const r = await runBridge(tmp)
    expect(r.out.length).toBe(0); expect(r.err).toBe(''); expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(1500)
  })

  it('pet aberto: envia só a lista fixa de números + session_id; não imprime nada', async () => {
    fs.mkdirSync(path.join(tmp, 'ClaudePet'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'ClaudePet', 'endpoint.json'), JSON.stringify({ port, token: 'tok-ponte' }))
    const r = await runBridge(tmp)
    expect(r.out.length).toBe(0); expect(r.code).toBe(0)
    const sent = JSON.parse(bodies.at(-1)!)
    expect(sent).toEqual({
      session_id: 'abc-123',
      context_window: { used_percentage: 6, context_window_size: 1_000_000, current_usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 20 } },
      rate_limits: { five_hour: { used_percentage: 94, resets_at: expect.any(Number) }, seven_day: { used_percentage: 70, resets_at: expect.any(Number) } }
    })
    expect(srv.stats.usageReceived).toBeGreaterThan(0)
  })

  it('serviço que não responde: desiste em ~300 ms, sem erro', async () => {
    const hang = (await import('node:http')).createServer(() => { /* nunca responde */ })
    const hp = await new Promise<number>((r) => hang.listen(0, '127.0.0.1', () => r((hang.address() as any).port)))
    fs.mkdirSync(path.join(tmp, 'ClaudePet'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'ClaudePet', 'endpoint.json'), JSON.stringify({ port: hp, token: 'x' }))
    const r = await runBridge(tmp)
    hang.closeAllConnections(); hang.close()
    expect(r.code).toBe(0); expect(r.out.length).toBe(0)
    expect(r.ms).toBeLessThan(1400)
  })

  it('texto mínimo opcional', async () => {
    cfg(tmp, { minimal: true })
    expect((await runBridge(tmp)).out.toString()).toBe('ctx 6% · 5h 94% · sem 70%')
  })

  it('encadeada (cmd): saída do original byte a byte, mesma entrada, mesmo exit code', async () => {
    cfg(tmp, { chain: `"${process.execPath}" -e "process.stdin.pipe(process.stdout)"` })
    const r = await runBridge(tmp)
    expect(r.out.toString()).toBe(INPUT)
    cfg(tmp, { chain: `"${process.execPath}" -e "process.stdout.write('\\u00e1 \\x1b[33mok\\x1b[0m\\n');process.exit(3)"` })
    const r2 = await runBridge(tmp)
    expect(r2.out).toEqual(Buffer.from('á \x1b[33mok\x1b[0m\n'))
    expect(r2.code).toBe(3)
  })

  it.skipIf(!gitBash)('encadeada (Git Bash, como o Claude Code roda no Windows)', async () => {
    cfg(tmp, { chain: 'printf "bash:%s" "$(cat | head -c 13)"' })
    const r = await runBridge(tmp, { SHELL: gitBash })
    expect(r.out.toString()).toBe('bash:{"session_id"')
  })

  it('encadeada com pet fechado continua imprimindo o original', async () => {
    cfg(tmp, { chain: `"${process.execPath}" -e "process.stdout.write('X')"` })
    const r = await runBridge(tmp)
    expect(r.out.toString()).toBe('X')
  })

  it('entrada inválida: nada enviado, nada impresso, exit 0', async () => {
    const r = await runBridge(tmp, {}, 'não é json')
    expect(r.out.length).toBe(0); expect(r.code).toBe(0)
  })

  it('tempo de inicialização (mediana de 7, pet fechado)', async () => {
    const ms: number[] = []
    for (let i = 0; i < 7; i++) ms.push((await runBridge(tmp)).ms)
    const med = ms.sort((a, b) => a - b)[3]
    console.log(`ponte: mediana ${med} ms (${ms.join(', ')})`)
    expect(med).toBeLessThan(500) // teto folgado p/ CI lento; o número real é registrado acima
  })
})
