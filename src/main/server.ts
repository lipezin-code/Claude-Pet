import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { HookEvent } from '../shared/types'
import type { UsageUpdate } from '../shared/usage'

const SID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const str = z.string().max(500).optional()
export const EventSchema = z.object({
  session_id: SID,
  hook_event_name: z.string().regex(/^[A-Za-z]{1,40}$/),
  cwd: z.string().max(1024).optional(),
  tool_name: str, agent_id: str, agent_type: str, agent_name: str, source: str, notification_type: str, message: str, error: str, task_subject: str, task_id: str, teammate_name: str,
  ts: z.number().optional()
})

export function normalize(raw: unknown): HookEvent | null {
  const p = EventSchema.safeParse(raw)
  if (!p.success) return null
  const d = p.data
  return {
    sessionId: d.session_id, event: d.hook_event_name, ts: Date.now(), cwd: d.cwd, tool: d.tool_name,
    agentId: d.agent_id, agentType: d.agent_type, agentName: d.agent_name, source: d.source, notificationType: d.notification_type, message: d.message,
    error: d.error, taskSubject: d.task_subject, taskId: d.task_id, teammate: d.teammate_name
  }
}

// Faixa de uso: SÓ números. Campos extras são descartados (z.object remove chaves desconhecidas).
const pct = z.number().finite().min(0).max(100)
const tok = z.number().int().nonnegative().max(1e9)
const resetsAt = z.number().int().refine((v) => v >= 1_577_836_800 && v <= Date.now() / 1000 + 30 * 86_400, 'resets_at implausível')
const limit = z.object({ used_percentage: pct, resets_at: resetsAt })
export const UsageSchema = z.object({
  session_id: SID,
  context_window: z.object({
    used_percentage: pct.nullable().optional(), // null antes da 1ª resposta
    context_window_size: z.number().int().positive().max(1e8).optional(),
    current_usage: z.object({ input_tokens: tok, cache_creation_input_tokens: tok, cache_read_input_tokens: tok }).nullable().optional()
  }).optional(),
  rate_limits: z.object({ five_hour: limit.optional(), seven_day: limit.optional() }).optional()
})

/** Valida o corpo de /usage. Erro = só os caminhos dos campos inválidos (sem valores). */
export function normalizeUsage(raw: unknown): { ok: true; u: UsageUpdate } | { ok: false; fields: string } {
  const p = UsageSchema.safeParse(raw)
  if (!p.success) return { ok: false, fields: [...new Set(p.error.issues.map((i) => i.path.join('.') || '(raiz)'))].join(', ').slice(0, 200) }
  const d = p.data, cw = d.context_window, cu = cw?.current_usage
  const u: UsageUpdate = { sessionId: d.session_id }
  if (cu) u.last = { read: cu.cache_read_input_tokens, creation: cu.cache_creation_input_tokens, input: cu.input_tokens }
  if (cw?.used_percentage != null && cw.context_window_size)
    u.ctx = { pct: cw.used_percentage, size: cw.context_window_size, tokens: u.last ? u.last.read + u.last.creation + u.last.input : undefined }
  const lim = (l?: { used_percentage: number; resets_at: number }) => (l ? { pct: l.used_percentage, resetsAt: l.resets_at } : undefined)
  u.five = lim(d.rate_limits?.five_hour)
  u.week = lim(d.rate_limits?.seven_day)
  return { ok: true, u }
}

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Servidor HTTP só-loopback. Exige Bearer token. Corpo limitado a 64KB. */
export function createEventServer(token: string, onEvent: (e: HookEvent) => void, onUsage?: (u: UsageUpdate) => void, onReject?: (why: string) => void) {
  const state = { received: 0, rejected: 0, lastAt: 0, usageReceived: 0 }
  const server = http.createServer((req, res) => {
    const end = (code: number, body = '') => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body) }
    const auth = req.headers.authorization ?? ''
    if (!safeEq(auth, `Bearer ${token}`)) { state.rejected++; return end(401) }
    if (req.method === 'GET' && req.url === '/health') return end(200, JSON.stringify({ ok: true, ...state }))
    const usage = req.url === '/usage' && !!onUsage
    if (req.method !== 'POST' || (req.url !== '/event' && !usage)) return end(404)
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 65_536) { state.rejected++; end(413); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (usage) {
          const r = normalizeUsage(body)
          if (!r.ok) { state.rejected++; onReject?.(`usage rejeitado: ${r.fields}`); return end(400) }
          state.usageReceived++
          onUsage!(r.u)
          return end(204)
        }
        const ev = normalize(body)
        if (!ev) { state.rejected++; return end(400) }
        state.received++; state.lastAt = Date.now()
        onEvent(ev)
        end(204)
      } catch { state.rejected++; end(400) }
    })
  })
  const listen = (): Promise<number> =>
    new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
    })
  return { server, listen, stats: state }
}
