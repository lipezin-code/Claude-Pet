import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { applyEvent, newSession, tick } from '../shared/machine'
import type { HookEvent, Origin, Session } from '../shared/types'

export interface Discovered { sessionId: string; pid: number; cwd: string; origin: Origin }

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e: any) { return e?.code === 'EPERM' }
}

/** Leitura SOMENTE-LEITURA de ~/.claude/sessions/<pid>.json (1 arquivo por sessão em execução). */
export function readSessionFiles(dir: string): Discovered[] {
  let names: string[]
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out: Discovered[] = []
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      if (typeof j.sessionId !== 'string' || typeof j.pid !== 'number') continue
      const ep = String(j.entrypoint ?? '').toLowerCase()
      out.push({ sessionId: j.sessionId, pid: j.pid, cwd: String(j.cwd ?? ''), origin: ep === 'cli' ? 'cli' : ep.includes('desktop') ? 'desktop' : 'unknown' })
    } catch { /* arquivo sendo escrito/corrompido: ignora */ }
  }
  return out
}

export class SessionManager extends EventEmitter {
  sessions = new Map<string, Session>()
  constructor(
    private sessionsDir: string,
    private isAlive: (pid: number) => boolean = pidAlive,
    private now: () => number = Date.now
  ) { super() }

  list(): Session[] { return [...this.sessions.values()] }

  /** Restaura sessões salvas: o estado real é desconhecido até haver evidência. Encerrada continua encerrada
   *  (mantém stateSince, senão o prune de 24 h zera a cada abertura do pet e a lista só cresce). */
  restore(saved: Session[]) {
    for (const s of saved) {
      this.sessions.set(s.id, s.liveness === 'ended'
        ? { ...s, state: 'DISCONNECTED', tool: undefined }
        : { ...s, state: 'UNKNOWN', liveness: 'unknown', tool: undefined, note: 'Aguardando eventos', stateSince: this.now() })
    }
  }

  private chatBusy = new Set<string>() // conversa do mini chat respondendo agora (o `claude -p` não tem arquivo de sessão)

  ingest(e: HookEvent) {
    const prev = this.sessions.get(e.sessionId) ?? newSession(e.sessionId, e.cwd, e.ts)
    this.sessions.set(e.sessionId, applyEvent(prev, e))
    this.emit('change', e)
  }

  markChat(id: string, cwd: string) {
    const s = this.sessions.get(id) ?? newSession(id, cwd, this.now())
    this.sessions.set(id, { ...s, origin: 'chat' })
    this.chatBusy.add(id)
  }
  /** O `claude -p` do mini chat terminou: a sessão pode encerrar como qualquer outra. */
  chatDone(id: string) { this.chatBusy.delete(id) }

  setPinned(id: string, pinned: boolean) {
    const s = this.sessions.get(id); if (s) { this.sessions.set(id, { ...s, pinned }); this.emit('change') }
  }

  /** Tira do pet sessões que não estão ativas. Não toca na transcrição do Claude Code. Devolve os ids removidos. */
  forget(ids: string[]): string[] {
    const gone = ids.filter((id) => { const s = this.sessions.get(id); return !!s && s.liveness !== 'active' && this.sessions.delete(id) })
    if (gone.length) this.emit('change')
    return gone
  }

  /** Reconcilia com os arquivos de sessão e processos vivos. */
  discover() {
    const found = readSessionFiles(this.sessionsDir)
    const byId = new Map(found.map((d) => [d.sessionId, d]))
    for (const d of found) {
      if (!this.isAlive(d.pid)) continue
      const s = this.sessions.get(d.sessionId) ?? newSession(d.sessionId, d.cwd, this.now())
      // existir ≠ estar trabalhando: só confirma processo vivo; estado vem dos eventos
      this.sessions.set(d.sessionId, {
        ...s, pid: d.pid, cwd: s.cwd || d.cwd, project: s.project === '(desconhecido)' ? newSession('', d.cwd).project : s.project,
        origin: s.origin === 'chat' ? 'chat' : d.origin,
        liveness: s.lastEventAt ? s.liveness === 'ended' ? 'active' : s.liveness : 'unknown',
        state: s.lastEventAt || s.state !== 'UNKNOWN' ? s.state : 'UNKNOWN'
      })
    }
    for (const [id, s] of this.sessions) {
      if (s.liveness === 'ended') continue
      const d = byId.get(id)
      // sem arquivo de sessão (e sem evento recente, p/ tolerar atraso na criação) ou processo morto
      const dead = d ? !this.isAlive(d.pid) : this.now() - s.lastEventAt > 30_000
      if (dead && !this.chatBusy.has(id)) {
        this.sessions.set(id, { ...s, liveness: 'ended', state: 'DISCONNECTED', stateSince: this.now(), tool: undefined })
      }
    }
    this.emit('change')
  }

  tickAll() {
    const t = this.now()
    let changed = false
    for (const [id, s] of this.sessions) {
      const n = tick(s, t)
      if (n !== s) { this.sessions.set(id, n); changed = true }
    }
    if (changed) this.emit('change')
  }

  prune(maxAgeMs = 24 * 3600_000) {
    for (const [id, s] of this.sessions) {
      if (s.liveness === 'ended' && this.now() - Math.max(s.stateSince, s.lastEventAt) > maxAgeMs) this.sessions.delete(id)
    }
  }
}
