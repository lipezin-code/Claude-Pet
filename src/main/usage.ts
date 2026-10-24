import fs from 'node:fs'
import path from 'node:path'
import type { AccountUsage, CacheTotals, SessionUsage, UsageSnapshot, UsageUpdate } from '../shared/usage'

const SID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SESSIONS = 50

/** Uso em memória: por sessão (contexto/cache) + registro da conta (limites, o mais recente de qualquer sessão vence). */
export class UsageStore {
  sessions = new Map<string, SessionUsage>()
  account: AccountUsage | null = null
  constructor(private now: () => number = Date.now) {}

  /** Restaura só os limites persistidos (números + horário). Qualquer outra coisa é ignorada. */
  restoreAccount(a: unknown) {
    const ok = (l: any) => l && Number.isFinite(l.pct) && l.pct >= 0 && l.pct <= 100 && Number.isInteger(l.resetsAt)
    const x = a as any
    if (!x || !Number.isFinite(x.updatedAt) || !(ok(x.five) || ok(x.week))) return
    this.account = { updatedAt: x.updatedAt, five: ok(x.five) ? { pct: x.five.pct, resetsAt: x.five.resetsAt } : undefined, week: ok(x.week) ? { pct: x.week.pct, resetsAt: x.week.resetsAt } : undefined }
  }

  /** Retorna true se os limites da conta mudaram (p/ persistir). */
  apply(u: UsageUpdate): boolean {
    const t = this.now()
    const prev = this.sessions.get(u.sessionId)
    this.sessions.delete(u.sessionId) // reinsere no fim: ordem = mais recente por último
    this.sessions.set(u.sessionId, { ...prev, ctx: u.ctx ?? prev?.ctx, last: u.last ?? prev?.last, updatedAt: t })
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!)
    if (!u.five && !u.week) return false // payload sem rate_limits não apaga o que veio de outra sessão
    const a = this.account
    const changed = !a || a.five?.pct !== u.five?.pct || a.week?.pct !== u.week?.pct || a.five?.resetsAt !== u.five?.resetsAt || a.week?.resetsAt !== u.week?.resetsAt
    this.account = { five: u.five ?? a?.five, week: u.week ?? a?.week, updatedAt: t }
    return changed
  }

  setTotals(sessionId: string, totals: CacheTotals) {
    const s = this.sessions.get(sessionId)
    if (s) this.sessions.set(sessionId, { ...s, totals: { ...totals } })
  }

  snapshot(): UsageSnapshot {
    return { account: this.account, sessions: Object.fromEntries(this.sessions) }
  }
}

/**
 * Acha a transcrição de uma sessão: <projects>/<pasta>/<sessionId>.jsonl.
 * O id passa pelo mesmo regex do servidor (sem / \ ..); pastas que são links são ignoradas e o realpath
 * do arquivo precisa continuar dentro de <projects> (bloqueia symlink/junction apontando para fora).
 */
export function findTranscript(projectsDir: string, sessionId: string): string | null {
  if (!SID.test(sessionId)) return null
  let root: string
  let dirs: fs.Dirent[]
  try { root = fs.realpathSync(projectsDir); dirs = fs.readdirSync(root, { withFileTypes: true }) } catch { return null }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const f = path.join(root, d.name, `${sessionId}.jsonl`)
    try {
      const real = fs.realpathSync(f)
      if (isInside(root, real) && fs.statSync(real).isFile()) return real
    } catch { /* não existe aqui */ }
  }
  return null
}

export function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p)
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

export const READ_CHUNK = 1 << 20 // 1 MB por leitura
export const MAX_LINE = 8 << 20 // linha maior que isto é descartada (blobs de request)
const NL = 0x0a

/**
 * Leitura incremental de UMA transcrição. Guarda o deslocamento, soma os números de uso de cada resposta
 * uma única vez (a mesma resposta aparece em várias linhas, uma por bloco de conteúdo) e não guarda texto.
 */
export class TranscriptTail {
  offset = 0
  totals: CacheTotals = { read: 0, creation: 0, input: 0 }
  private carry: Buffer[] = []
  private carryLen = 0
  private skipping = false
  private seen = new Set<string>()
  private order: string[] = []
  constructor(public file: string) {}

  private reset() {
    this.offset = 0; this.totals = { read: 0, creation: 0, input: 0 }
    this.carry = []; this.carryLen = 0; this.skipping = false; this.seen.clear(); this.order = []
  }

  /** Lê até `maxBytes` novos. Retorna true se ainda há bytes por ler. */
  async readNew(maxBytes = READ_CHUNK): Promise<boolean> {
    const fh = await fs.promises.open(this.file, 'r')
    try {
      const { size } = await fh.stat()
      if (size < this.offset) this.reset() // arquivo truncado/recriado: recomeça
      const n = Math.min(size - this.offset, maxBytes)
      if (n <= 0) return false
      const buf = Buffer.allocUnsafe(n)
      const { bytesRead } = await fh.read(buf, 0, n, this.offset)
      this.offset += bytesRead
      this.feed(buf.subarray(0, bytesRead))
      return this.offset < size
    } finally { await fh.close() }
  }

  private feed(b: Buffer) {
    let start = 0
    for (let i = b.indexOf(NL); i !== -1; i = b.indexOf(NL, start)) {
      const part = b.subarray(start, i)
      start = i + 1
      if (this.skipping) { this.skipping = false; continue } // fim da linha gigante
      const big = this.carryLen + part.length > MAX_LINE
      const line = big ? null : this.carryLen ? Buffer.concat([...this.carry, part]) : part
      this.carry = []; this.carryLen = 0
      if (line) this.line(line)
    }
    const rest = b.subarray(start)
    if (!rest.length || this.skipping) return
    if (this.carryLen + rest.length > MAX_LINE) { this.carry = []; this.carryLen = 0; this.skipping = true; return }
    this.carry.push(Buffer.from(rest)); this.carryLen += rest.length
  }

  private line(l: Buffer) {
    if (l.indexOf('"usage"') === -1) return // filtro barato antes do parse
    let j: any
    try { j = JSON.parse(l.toString('utf8')) } catch { return }
    const u = j?.type === 'assistant' ? j.message?.usage : undefined
    if (!u || typeof u !== 'object') return
    const id = typeof j.message.id === 'string' ? j.message.id : typeof j.requestId === 'string' ? j.requestId : null
    if (id) {
      if (this.seen.has(id)) return
      this.seen.add(id); this.order.push(id)
      if (this.order.length > 1000) this.seen.delete(this.order.shift()!) // duplicatas são linhas vizinhas
    }
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
    this.totals.read += n(u.cache_read_input_tokens)
    this.totals.creation += n(u.cache_creation_input_tokens)
    this.totals.input += n(u.input_tokens)
  }
}

/** Um leitor por sessão; uma leitura por vez (atualizações durante a leitura viram uma rodada extra). */
export class TranscriptReader {
  private tails = new Map<string, TranscriptTail | null>()
  private busy = new Set<string>()
  private again = new Set<string>()
  constructor(private projectsDir: string, private onTotals: (sid: string, t: CacheTotals) => void, private onError: (msg: string) => void = () => {}) {}

  update(sid: string) {
    if (this.busy.has(sid)) { this.again.add(sid); return }
    this.busy.add(sid)
    void this.run(sid).finally(() => {
      this.busy.delete(sid)
      if (this.again.delete(sid)) this.update(sid)
    })
  }

  private async run(sid: string) {
    let tail = this.tails.get(sid)
    if (!tail) {
      const f = findTranscript(this.projectsDir, sid)
      if (!f) return // ainda não existe (1ª chamada) ou fora de <projects>: tenta de novo na próxima
      tail = new TranscriptTail(f)
      this.tails.set(sid, tail)
      if (this.tails.size > MAX_SESSIONS) this.tails.delete(this.tails.keys().next().value!)
    }
    try {
      // até 64 MB por rodada (transcrição longa na 1ª leitura); o resto continua na próxima atualização
      for (let i = 0; i < 64 && (await tail.readNew()); i++) { /* lendo */ }
      this.onTotals(sid, tail.totals)
    } catch (e: any) {
      this.tails.delete(sid)
      this.onError(`transcrição ${sid.slice(0, 8)}: ${e?.code ?? 'erro de leitura'}`)
    }
  }
}
