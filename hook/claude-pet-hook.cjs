// Hook do Claude Pet. Roda a cada evento do Claude Code.
// Regras: nunca bloquear, nunca imprimir, sempre exit 0. Só envia campos em whitelist
// (sem prompt, sem tool_input, sem transcript) para o serviço loopback do Claude Pet.
// Exceção única: da ferramenta Agent sai só o `name` (nome do membro de Agent Team). O tool_input inteiro
// (que contém o prompt) nunca é gravado nem enviado.
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const done = () => process.exit(0)
setTimeout(done, 2500).unref() // teto duro

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { raw += c; if (raw.length > 1_000_000) done() })
process.stdin.on('end', () => {
  try {
    const i = JSON.parse(raw)
    const spawnName = i.tool_name === 'Agent' && i.tool_input && typeof i.tool_input.name === 'string' ? i.tool_input.name.slice(0, 64) : undefined
    const ev = {
      session_id: i.session_id,
      hook_event_name: i.hook_event_name,
      cwd: i.cwd,
      tool_name: i.tool_name,
      agent_id: i.agent_id,
      agent_type: typeof i.agent_type === 'string' ? i.agent_type.slice(0, 64) : undefined,
      agent_name: spawnName,
      source: i.source,
      notification_type: i.notification_type,
      message: typeof i.message === 'string' ? i.message.slice(0, 200) : undefined,
      error: i.error,
      task_subject: typeof i.task_subject === 'string' ? i.task_subject.slice(0, 120) : undefined,
      task_id: typeof i.task_id === 'string' ? i.task_id.slice(0, 64) : undefined,
      teammate_name: typeof i.teammate_name === 'string' ? i.teammate_name.slice(0, 64) : undefined,
      ts: Date.now()
    }
    const ep = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'ClaudePet', 'endpoint.json'), 'utf8'))
    const body = JSON.stringify(ev)
    const req = http.request(
      { host: '127.0.0.1', port: ep.port, path: '/event', method: 'POST', timeout: 1500,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer ' + ep.token } },
      (res) => { res.resume(); res.on('end', done) }
    )
    req.on('error', done)
    req.on('timeout', () => { req.destroy(); done() })
    req.end(body)
  } catch { done() } // pet fechado / JSON ruim: silêncio
})
