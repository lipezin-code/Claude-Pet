import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Roda o hook real (node hook/claude-pet-hook.cjs) contra um servidor local e olha o corpo BRUTO enviado.
function runHook(input: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let b = ''
      req.on('data', (c) => { b += c })
      req.on('end', () => { res.writeHead(204).end(); srv.close(); resolve(JSON.parse(b)) })
    })
    srv.listen(0, '127.0.0.1', () => {
      const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-hook-'))
      fs.mkdirSync(path.join(appData, 'ClaudePet'))
      fs.writeFileSync(path.join(appData, 'ClaudePet', 'endpoint.json'), JSON.stringify({ port: (srv.address() as { port: number }).port, token: 't' }))
      const p = spawn(process.execPath, [path.resolve('hook/claude-pet-hook.cjs')], { env: { ...process.env, APPDATA: appData } })
      p.on('error', reject)
      p.stdin.end(JSON.stringify(input))
    })
  })
}

describe('hook: o que sai da máquina', () => {
  it('ferramenta Agent: só o name do tool_input; nunca prompt/description/tool_input', async () => {
    const body = await runHook({
      session_id: 'lead0001', hook_event_name: 'PreToolUse', tool_name: 'Agent',
      tool_input: { name: 'back', prompt: 'SEGREDO-DO-PROMPT', description: 'TITULO', subagent_type: 'implementador' }
    })
    const raw = JSON.stringify(body)
    expect(body.agent_name).toBe('back')
    expect(raw).not.toContain('SEGREDO-DO-PROMPT')
    expect(raw).not.toContain('TITULO')
    expect(raw).not.toContain('implementador')
    expect(body).not.toHaveProperty('tool_input')
  })
  it('Agent Teams: teammate_name e task_id passam, task_description não', async () => {
    const body = await runHook({
      session_id: 'lead0001', hook_event_name: 'TaskCompleted', teammate_name: 'front', task_id: 't-1',
      task_subject: 'Revisar README', task_description: 'DESCRICAO-LONGA'
    })
    expect([body.teammate_name, body.task_id, body.task_subject]).toEqual(['front', 't-1', 'Revisar README'])
    expect(JSON.stringify(body)).not.toContain('DESCRICAO-LONGA')
  })
})
