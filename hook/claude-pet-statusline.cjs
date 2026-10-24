// Ponte da status line do Claude Pet. O Claude Code roda isto a cada redesenho da status line.
// Regras: nunca gravar a entrada (nem em disco, nem em log); só envia uma lista fixa de NÚMEROS + session_id
// ao serviço loopback do pet (mesmo endpoint/token dos hooks), com timeout curto e falha em silêncio.
// Se havia uma status line antes da instalação ("chain"), roda o comando original com a mesma entrada
// e imprime exatamente a saída dele, mesmo com o pet fechado.
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(process.env.APPDATA || '', 'ClaudePet')
let cfg = {}
try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'statusline.json'), 'utf8')) } catch { /* sem config: sem encadeamento */ }
const chain = typeof cfg.chain === 'string' && cfg.chain ? cfg.chain : null

let exitCode = 0
let pending = 2 // envio ao pet + saída (comando encadeado ou texto próprio)
const finish = () => { if (--pending === 0) process.exit(exitCode) }
setTimeout(() => process.exit(exitCode), chain ? 10_000 : 1500).unref() // teto duro

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const limit = (l) => (l && num(l.used_percentage) !== undefined && num(l.resets_at) !== undefined ? { used_percentage: l.used_percentage, resets_at: l.resets_at } : undefined)

function pick(i) {
  const cw = i.context_window || {}
  const cu = cw.current_usage
  const rl = i.rate_limits
  return {
    session_id: typeof i.session_id === 'string' ? i.session_id : undefined,
    context_window: {
      used_percentage: num(cw.used_percentage),
      context_window_size: num(cw.context_window_size),
      current_usage: cu && typeof cu === 'object'
        ? { input_tokens: num(cu.input_tokens), cache_creation_input_tokens: num(cu.cache_creation_input_tokens), cache_read_input_tokens: num(cu.cache_read_input_tokens) }
        : undefined
    },
    rate_limits: rl && typeof rl === 'object' ? { five_hour: limit(rl.five_hour), seven_day: limit(rl.seven_day) } : undefined
  }
}

function send(body) {
  let sent = false
  const done = () => { if (!sent) { sent = true; finish() } }
  try {
    const ep = JSON.parse(fs.readFileSync(path.join(dir, 'endpoint.json'), 'utf8'))
    const data = JSON.stringify(body)
    const req = require('node:http').request(
      { host: '127.0.0.1', port: ep.port, path: '/usage', method: 'POST', timeout: 300,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: 'Bearer ' + ep.token } },
      (res) => { res.resume(); res.on('end', done) }
    )
    req.on('error', done)
    req.on('timeout', () => { req.destroy() }) // destroy dispara 'error' -> finish
    req.end(data)
  } catch { done() } // pet fechado: silêncio
}

function runChain(raw) {
  // mesmo shell que o Claude Code usou para nos chamar (Git Bash no Windows: SHELL aponta para bash.exe)
  const { spawn } = require('node:child_process')
  const sh = process.env.SHELL
  const p = sh ? spawn(sh, ['-c', chain], { windowsHide: true }) : spawn(chain, { shell: true, windowsHide: true })
  const out = []
  p.stdout.on('data', (c) => out.push(c))
  p.stderr.on('data', () => {})
  p.on('error', () => { exitCode = 0; finish() })
  p.on('close', (code) => { process.stdout.write(Buffer.concat(out)); exitCode = typeof code === 'number' ? code : 0; finish() })
  p.stdin.on('error', () => {})
  p.stdin.end(raw)
}

function minimal(b) {
  const parts = []
  const cw = b.context_window
  if (cw && cw.used_percentage !== undefined) parts.push(`ctx ${Math.round(cw.used_percentage)}%`)
  const rl = b.rate_limits
  if (rl && rl.five_hour) parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`)
  if (rl && rl.seven_day) parts.push(`sem ${Math.round(rl.seven_day.used_percentage)}%`)
  return parts.join(' · ')
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { if (raw.length < 1_000_000) raw += c })
process.stdin.on('end', () => {
  let body = null
  try { body = pick(JSON.parse(raw)) } catch { /* entrada ruim: não envia */ }
  if (chain) runChain(raw)
  else { if (cfg.minimal && body) process.stdout.write(minimal(body)); finish() }
  if (body && body.session_id) send(body); else finish()
})
