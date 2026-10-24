import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEventServer, normalizeUsage } from '../src/main/server'
import { UsageStore } from '../src/main/usage'
import { bandModel, cacheHit, fmtAgo, fmtReset, fmtTokens, levelFor, USAGE_STALE_MS, type UsageSnapshot } from '../src/shared/usage'

const NOW_S = Math.floor(Date.now() / 1000)
const valid = () => ({
  session_id: 'abc-123',
  context_window: { used_percentage: 21, context_window_size: 1_000_000, current_usage: { input_tokens: 2, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 202_000 } },
  rate_limits: { five_hour: { used_percentage: 41, resets_at: NOW_S + 3600 }, seven_day: { used_percentage: 22, resets_at: NOW_S + 86_400 } }
})
const bad = (mut: (v: any) => void) => { const v: any = valid(); mut(v); return normalizeUsage(v).ok }

describe('validador do payload de uso', () => {
  it('aceita payload real e monta tokens = entrada + cache', () => {
    const r = normalizeUsage(valid())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.u).toMatchObject({ sessionId: 'abc-123', ctx: { pct: 21, size: 1_000_000, tokens: 212_002 }, five: { pct: 41 }, week: { pct: 22 } })
  })
  it('campos ausentes: só session_id basta; null antes da 1ª resposta não vira 0%', () => {
    const r = normalizeUsage({ session_id: 'a', context_window: { used_percentage: null, context_window_size: 1_000_000, current_usage: null } })
    expect(r.ok && r.u.ctx === undefined && r.u.five === undefined).toBe(true)
    expect(normalizeUsage({}).ok).toBe(false)
  })
  it('rejeita string no lugar de número, negativo, >100, NaN, gigante', () => {
    expect(bad((v) => { v.context_window.used_percentage = '21' })).toBe(false)
    expect(bad((v) => { v.rate_limits.five_hour.used_percentage = -1 })).toBe(false)
    expect(bad((v) => { v.rate_limits.seven_day.used_percentage = 100.5 })).toBe(false)
    expect(bad((v) => { v.context_window.used_percentage = NaN })).toBe(false)
    expect(bad((v) => { v.context_window.current_usage.cache_read_input_tokens = 1e12 })).toBe(false)
    expect(bad((v) => { v.context_window.current_usage.input_tokens = 1.5 })).toBe(false)
    expect(bad((v) => { v.context_window.context_window_size = 0 })).toBe(false)
    expect(bad((v) => { v.rate_limits.five_hour.resets_at = 12 })).toBe(false) // implausível (1970)
    expect(bad((v) => { v.rate_limits.five_hour.resets_at = NOW_S + 400 * 86_400 })).toBe(false)
    expect(bad((v) => { v.session_id = '../../etc' })).toBe(false)
  })
  it('campos extras são ignorados (não chegam ao app)', () => {
    const v: any = valid()
    v.transcript_path = 'C:\\x'; v.model = { display_name: 'x' }; v.context_window.extra = 'texto'; v.rate_limits.five_hour.note = 'x'
    const r = normalizeUsage(v)
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toMatch(/transcript|display_name|texto|note/)
  })
  it('erro informa só nomes de campos, nunca valores', () => {
    const r = normalizeUsage({ session_id: 'segredo-123', context_window: { used_percentage: 'segredo' } })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.fields).toBe('context_window.used_percentage'); expect(r.fields).not.toContain('segredo') }
  })
})

describe('rota /usage', () => {
  const got: unknown[] = []
  const rej: string[] = []
  const srv = createEventServer('tok', () => {}, (u) => got.push(u), (w) => rej.push(w))
  let port = 0
  beforeAll(async () => { port = await srv.listen() })
  afterAll(() => { srv.server.close() })
  const post = (b: unknown, token = 'tok') => fetch(`http://127.0.0.1:${port}/usage`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(b) })
  it('mesmo token dos hooks; válido = 204, inválido = 400 com log sem dados', async () => {
    expect((await post(valid(), 'ruim')).status).toBe(401)
    expect((await post(valid())).status).toBe(204)
    expect((await post({ session_id: 'a', rate_limits: { five_hour: { used_percentage: 'x', resets_at: 1 } } })).status).toBe(400)
    expect(got).toHaveLength(1)
    expect(rej[0]).toMatch(/^usage rejeitado: rate_limits\.five_hour/)
  })
  it('sem onUsage a rota não existe (comportamento antigo)', async () => {
    const s = createEventServer('t', () => {}); const p = await s.listen()
    expect((await fetch(`http://127.0.0.1:${p}/usage`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' })).status).toBe(404)
    s.server.close()
  })
})

describe('cálculos e formatação', () => {
  it('cache hit = leitura / (leitura + criação + entrada)', () => {
    expect(cacheHit({ read: 90, creation: 9, input: 1 })).toBe(90)
    expect(cacheHit({ read: 0, creation: 0, input: 0 })).toBeNull()
    expect(cacheHit(undefined)).toBeNull()
  })
  it('limiares: âmbar >= 80, vermelho >= 95; Cache nunca em alerta', () => {
    expect([79.9, 80, 94.9, 95, 100].map((p) => levelFor(p, 'ctx'))).toEqual(['ok', 'warn', 'warn', 'crit', 'crit'])
    expect(levelFor(99, 'five')).toBe('crit')
    expect(levelFor(99, 'cache')).toBe('ok')
    expect(levelFor(null, 'week')).toBe('ok')
  })
  it('tokens em pt-BR', () => {
    expect([950, 212_345, 999_400, 999_600, 1_000_000, 2_140_000, 2_145_678].map(fmtTokens)).toEqual(['950', '212k', '999k', '1M', '1M', '2,14M', '2,15M'])
  })
  it('reset: hoje, dia da semana, data; já passado = null', () => {
    const now = new Date(2026, 9, 21, 10, 0).getTime() // quarta
    const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime() / 1000
    expect(fmtReset(at(21, 23, 20), now)).toBe('Reinicia 23:20')
    expect(fmtReset(at(22, 17, 10), now)).toBe('Reinicia qui 17:10')
    expect(fmtReset(at(30, 9, 5), now)).toBe('Reinicia 30/10 09:05')
    expect(fmtReset(at(21, 9, 0), now)).toBeNull()
  })
  it('"há X"', () => {
    expect(fmtAgo(0, 8000)).toBe('há 8 s')
    expect(fmtAgo(0, 5 * 60_000)).toBe('há 5 min')
  })
})

describe('modelo da faixa', () => {
  const now = Date.now()
  const base = (): UsageSnapshot => ({
    account: { five: { pct: 96, resetsAt: Math.floor(now / 1000) + 600 }, week: { pct: 70, resetsAt: Math.floor(now / 1000) + 86_400 }, updatedAt: now },
    sessions: { s1: { ctx: { pct: 21, size: 1_000_000, tokens: 212_000 }, totals: { read: 2_140_000, creation: 100_000, input: 0 }, updatedAt: now } }
  })
  const keys = (m: ReturnType<typeof bandModel>) => m.map((x) => x.key)
  it('completo: 4 medidores com subtextos prontos', () => {
    const m = bandModel(base(), 's1', now)
    expect(keys(m)).toEqual(['ctx', 'five', 'week', 'cache'])
    expect(m[0].sub).toBe('212k / 1M')
    expect(m[3].sub).toBe('Lidos 2,14M')
    expect(m[1].level).toBe('crit')
  })
  it('sem dado: "—", nunca 0%', () => {
    const m = bandModel({ account: null, sessions: {} }, null, now)
    expect(keys(m)).toEqual(['ctx', 'cache'])
    expect(m.every((x) => x.pct === null && x.sub === '—')).toBe(true)
  })
  it('sem rate_limits: esconde 5 horas e Semana', () => {
    expect(keys(bandModel({ ...base(), account: null }, 's1', now))).toEqual(['ctx', 'cache'])
  })
  it('reset já passou: "—" até chegar dado novo', () => {
    const u = base(); u.account!.five!.resetsAt = Math.floor(now / 1000) - 1
    const five = bandModel(u, 's1', now)[1]
    expect(five.pct).toBeNull(); expect(five.sub).toBe('—')
  })
  it('dado velho fica marcado', () => {
    const m = bandModel(base(), 's1', now + USAGE_STALE_MS + 1)
    expect(m.every((x) => x.stale)).toBe(true)
    expect(bandModel(base(), 's1', now).some((x) => x.stale)).toBe(false)
  })
  it('Cache alto nunca alerta; sem transcrição usa a última chamada e omite "Lidos"', () => {
    const u = base(); u.sessions.s1 = { last: { read: 99, creation: 1, input: 0 }, updatedAt: now }
    const c = bandModel(u, 's1', now)[3]
    expect(c).toMatchObject({ pct: 99, level: 'ok', sub: 'Última chamada' })
  })
})

describe('UsageStore', () => {
  it('limites são da conta: o mais recente vence; payload sem rate_limits não apaga', () => {
    let t = 1000
    const s = new UsageStore(() => t)
    expect(s.apply({ sessionId: 'a', five: { pct: 10, resetsAt: 2e9 } })).toBe(true)
    t = 2000
    expect(s.apply({ sessionId: 'b', five: { pct: 30, resetsAt: 2e9 } })).toBe(true)
    expect(s.apply({ sessionId: 'a', ctx: { pct: 5, size: 1e6 } })).toBe(false)
    expect(s.account).toMatchObject({ five: { pct: 30 }, updatedAt: 2000 })
    expect(s.snapshot().sessions.a.ctx?.pct).toBe(5)
  })
  it('restauração aceita só números válidos', () => {
    const s = new UsageStore()
    s.restoreAccount({ updatedAt: 1, five: { pct: 'x', resetsAt: 1 } })
    expect(s.account).toBeNull()
    s.restoreAccount({ updatedAt: 1, five: { pct: 50, resetsAt: 2e9, extra: 'x' } })
    expect(s.account).toEqual({ updatedAt: 1, five: { pct: 50, resetsAt: 2e9 }, week: undefined })
  })
})
