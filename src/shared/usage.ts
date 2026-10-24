// Faixa de uso: tipos e funções PURAS (main + renderer). Só números entram aqui; os rótulos são montados por nós.

/** Dado mais velho que isto aparece esmaecido ("atualizado há X"). Único lugar com esse intervalo. */
export const USAGE_STALE_MS = 5 * 60_000

export interface Limit { pct: number; resetsAt: number } // resetsAt: epoch em SEGUNDOS (como vem da status line)
export interface AccountUsage { five?: Limit; week?: Limit; updatedAt: number }
export interface CacheTotals { read: number; creation: number; input: number }
export interface SessionUsage {
  ctx?: { pct: number; size: number; tokens?: number }
  last?: CacheTotals // current_usage da última chamada
  totals?: CacheTotals // soma da transcrição (respostas únicas); ausente = leitura falhou/ainda não houve
  updatedAt: number
}
export interface UsageSnapshot { account: AccountUsage | null; sessions: Record<string, SessionUsage> }

/** Atualização já validada pelo servidor (ver UsageSchema em src/main/server.ts). */
export interface UsageUpdate {
  sessionId: string
  ctx?: { pct: number; size: number; tokens?: number }
  last?: CacheTotals
  five?: Limit
  week?: Limit
}

export type Level = 'ok' | 'warn' | 'crit'
/** Âmbar a partir de 80%, vermelho a partir de 95%. Cache nunca entra em alerta (alto é bom). */
export function levelFor(pct: number | null, kind: 'ctx' | 'five' | 'week' | 'cache'): Level {
  if (pct == null || kind === 'cache') return 'ok'
  return pct >= 95 ? 'crit' : pct >= 80 ? 'warn' : 'ok'
}

/** Leitura de cache / (leitura + criação + entrada nova), em %. null = sem tokens para dividir. */
export function cacheHit(t: CacheTotals | undefined): number | null {
  if (!t) return null
  const den = t.read + t.creation + t.input
  return den > 0 ? (t.read / den) * 100 : null
}

const nf = (max: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: max })
/** 950 → "950", 212_345 → "212k", 1_000_000 → "1M", 2_140_000 → "2,14M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (Math.round(n / 1000) < 1000) return `${Math.round(n / 1000)}k`
  return `${nf(2).format(n / 1e6)}M`
}

const pad = (n: number) => String(n).padStart(2, '0')
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** "Reinicia 23:20" (hoje), "Reinicia qua 17:10" (até 6 dias), "Reinicia 05/11 17:10". null = já passou. */
export function fmtReset(resetsAtSec: number, now: number): string | null {
  const d = new Date(resetsAtSec * 1000)
  if (d.getTime() <= now) return null
  const n = new Date(now)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.toDateString() === n.toDateString()
  if (sameDay) return `Reinicia ${hm}`
  if (d.getTime() - now < 6 * 86_400_000) return `Reinicia ${WD[d.getDay()]} ${hm}`
  return `Reinicia ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`
}

export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  return s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`
}

export interface Meter {
  key: 'ctx' | 'five' | 'week' | 'cache'
  label: string
  pct: number | null // null = sem dado ("—")
  sub: string // subtexto do tile expandido
  level: Level
  stale: boolean
}

/** Modelo da faixa: o renderer só desenha isto. Sem rate_limits na conta: 5 horas e Semana somem. */
export function bandModel(u: UsageSnapshot | undefined, sessionId: string | null, now: number): Meter[] {
  const s = sessionId ? u?.sessions[sessionId] : undefined
  const sStale = !!s && now - s.updatedAt > USAGE_STALE_MS
  const meters: Meter[] = []
  const ctx = s?.ctx
  meters.push({
    key: 'ctx', label: 'Contexto', pct: ctx ? ctx.pct : null,
    sub: ctx ? `${ctx.tokens != null ? fmtTokens(ctx.tokens) : '—'} / ${fmtTokens(ctx.size)}` : '—',
    level: levelFor(ctx ? ctx.pct : null, 'ctx'), stale: sStale
  })
  const a = u?.account
  if (a && (a.five || a.week)) {
    const aStale = now - a.updatedAt > USAGE_STALE_MS
    for (const [key, label, l] of [['five', '5 horas', a.five], ['week', 'Semana', a.week]] as const) {
      const reset = l ? fmtReset(l.resetsAt, now) : null // reset já passou = dado expirado: "—" até chegar outro
      const pct = l && reset ? l.pct : null
      meters.push({ key, label, pct, sub: reset ?? '—', level: levelFor(pct, key), stale: aStale })
    }
  }
  // Cache: totais da transcrição; se a leitura falhou, só a última chamada (e sem "Lidos")
  const t = s?.totals ?? s?.last
  const hit = cacheHit(t)
  meters.push({
    key: 'cache', label: 'Cache', pct: hit,
    sub: s?.totals ? `Lidos ${fmtTokens(s.totals.read)}` : hit != null ? 'Última chamada' : '—',
    level: 'ok', stale: sStale
  })
  return meters
}

/** Texto do anel: "94%" ou "—". */
export const fmtPct = (p: number | null) => (p == null ? '—' : `${Math.round(p)}%`)
