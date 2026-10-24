import fs from 'node:fs'
import type { Skin } from '../shared/skins'
import { BODY } from '../shared/sprites'
import { z } from 'zod'
import { AgentTeamSchema, type AgentTeam } from '../shared/agentTeams'
import { autoBind, buildRoster, migrateAgent, newTeam, TeamsFile, type RosterRow, type Slot, type Team, type TeamAgent } from '../shared/teams'
import type { FoundTeam } from './agentTeams'
import type { Session } from '../shared/types'
import { JsonStore } from './store'

/**
 * Equipes salvas em %APPDATA%\ClaudePet\teams.json (nunca no repositório do projeto).
 * Arquivo tratado como não confiável: inválido => vira teams.json.invalid (não sobrescreve o que você tinha) e começa vazio.
 */
export class TeamStore {
  private store: JsonStore<{ teams: Team[]; agentTeams?: AgentTeam[]; removedTeams?: string[] }>
  teams: Team[] = []
  agentTeams: AgentTeam[] = [] // detectadas em ~/.claude/teams (cópia nossa; lá só lemos)
  private removedTeams: string[] = [] // você removeu: não volta enquanto a pasta existir
  constructor(private file: string, log: (m: string) => void) {
    this.store = new JsonStore(file, { teams: [] })
    if (!this.store.exists()) return
    const raw = this.store.read() as { teams?: { agents?: Record<string, unknown>[] }[] }
    // v anterior: cards de subagente (subId) dividiam a sessão do líder; subagente não é mais membro => solta
    for (const t of raw.teams ?? []) for (const a of t.agents ?? []) if (a.subId) { delete a.subId; delete a.sessionId; a.task = ''; a.validated = false }
    // v anterior: 5 funções fixas ({ role }) -> posição + função editável (mantém sessão e pasta)
    for (const t of raw.teams ?? []) if (t.agents) t.agents = t.agents.map(migrateAgent)
    const p = TeamsFile.extend({ agentTeams: z.array(AgentTeamSchema).max(10).optional(), removedTeams: z.array(z.string().max(80)).max(50).optional() }).safeParse(raw)
    if (p.success) { this.teams = p.data.teams; this.agentTeams = p.data.agentTeams ?? []; this.removedTeams = p.data.removedTeams ?? [] }
    else {
      log('equipes: teams.json inválido; guardado como teams.json.invalid')
      try { fs.renameSync(file, file + '.invalid') } catch { /* sem permissão: segue vazio e sobrescreve só ao salvar */ }
    }
  }
  private save() { this.store.write({ teams: this.teams, agentTeams: this.agentTeams, removedTeams: this.removedTeams }) }

  /** Equipe manual: uma só (criada no 1º uso). */
  private team(): Team {
    if (!this.teams.length) this.teams.push(newTeam())
    return this.teams[0]
  }
  private agent(id: Slot, fn: (a: TeamAgent) => TeamAgent) {
    const t = this.team()
    if (!t.agents.some((a) => a.id === id)) throw new Error('Agente inexistente')
    this.teams[0] = { ...t, agents: t.agents.map((a) => (a.id === id ? fn(a) : a)) }
    this.save()
  }

  /** Vincula (ou solta, com null) uma sessão a um card. Uma sessão pertence a um agente só. */
  bind(id: Slot, session: { id: string; cwd: string } | null) {
    if (session) this.teams = this.teams.map((t) => ({ ...t, agents: t.agents.map((a) => (a.sessionId === session.id ? { ...a, sessionId: undefined, worktree: undefined } : a)) }))
    // soltar também esquece a pasta, senão o revínculo automático pegaria a mesma sessão de volta
    this.agent(id, (a) => ({ ...a, sessionId: session?.id, worktree: session ? { path: session.cwd } : undefined }))
  }
  /** Monta/edita a equipe. Agente que continua mantém posição, sessão e pasta; removido some (com sua sessão). */
  setRoster(rows: RosterRow[]) {
    const r = buildRoster(rows)
    if (!r.ok) throw new Error(r.error)
    const t = this.team()
    const prev = new Map(t.agents.map((a) => [a.id, a]))
    const agents = r.agents.map((a) => { const p = prev.get(a.id); return p ? { ...a, sessionId: p.sessionId, worktree: p.worktree } : a })
    this.teams[0] = { ...t, agents }
    this.save()
  }
  setProject(projectPath: string) { this.teams[0] = { ...this.team(), projectPath }; this.save() }
  /** Card vai abrir terminal nessa pasta: solta a sessão antiga; o revínculo pela pasta pega a nova quando ela surgir. */
  setWorktree(id: Slot, p: string) { this.agent(id, (a) => ({ ...a, sessionId: undefined, worktree: { path: p } })) }
  /** Guarda a última entrega vista do card (só grava se mudou). */
  rememberDelivery(id: Slot, d: { hash: string; subject: string; at: number }): boolean {
    const a = this.team().agents.find((x) => x.id === id)
    if (!a || a.lastDelivery?.hash === d.hash) return false
    this.agent(id, (x) => ({ ...x, lastDelivery: { hash: d.hash, subject: d.subject.slice(0, 120), at: d.at } }))
    return true
  }
  setTeam(p: { name?: string; goal?: string }) {
    this.teams[0] = { ...this.team(), ...p }
    this.save()
  }
  /**
   * Agent Teams lidas do disco -> cards. Só entra equipe cujo líder (leadSessionId) é uma sessão conhecida.
   * Pasta sumiu => "encerrada" (fica para você ver como terminou; guarda as 10 mais recentes).
   * `ambiguous` só é recalculado quando a equipe é nova ou mudou de membros (lê definições de subagente).
   */
  syncAgentTeams(found: FoundTeam[], known: ReadonlySet<string>, ambiguous: (f: FoundTeam) => string[], now = Date.now()): boolean {
    let changed = false
    const seen = new Set<string>()
    for (const f of found) {
      if (!known.has(f.leadSessionId) || this.removedTeams.includes(f.id)) continue
      seen.add(f.id)
      const i = this.agentTeams.findIndex((t) => t.id === f.id)
      const prev = i >= 0 ? this.agentTeams[i] : undefined
      const same = prev && !prev.ended && prev.leadSessionId === f.leadSessionId && JSON.stringify(prev.members) === JSON.stringify(f.members)
      if (same) continue
      const next: AgentTeam = { ...f, ambiguous: ambiguous(f), ended: false, seenAt: now }
      if (i >= 0) this.agentTeams[i] = next; else this.agentTeams.push(next)
      changed = true
    }
    for (const t of this.agentTeams) if (!t.ended && !seen.has(t.id)) { t.ended = true; t.seenAt = now; changed = true }
    while (this.agentTeams.length > 10) this.agentTeams.splice(Math.max(0, this.agentTeams.findIndex((t) => t.ended)), 1)
    if (changed) this.save()
    return changed
  }

  /** Tira equipes detectadas do pet (só do teams.json; ~/.claude/teams não é tocado). */
  removeAgentTeams(ids: string[]): boolean {
    const gone = this.agentTeams.filter((t) => ids.includes(t.id)).map((t) => t.id)
    if (!gone.length) return false
    this.agentTeams = this.agentTeams.filter((t) => !gone.includes(t.id))
    this.removedTeams = [...this.removedTeams.filter((x) => !gone.includes(x)), ...gone].slice(-50)
    this.save()
    return true
  }

  /** Revínculo pela pasta do worktree. */
  autoBind(sessions: Session[]): boolean {
    const r = autoBind(this.teams, sessions)
    if (r) { this.teams = r; this.save() }
    return !!r
  }
}

const EYES: [number, number, number, number][] = [[4, 3, 2, 2], [10, 3, 2, 2]] // mesmos olhos abertos do PetSprite

/** Mascote parado (corpo + olhos) em BGRA, quadrado, para o ícone da notificação. Sem SVG/rasterizador no main. */
export function skinBitmap(skin: Skin, scale = 4): { buf: Buffer; size: number } {
  const size = 16 * scale, top = 1 // corpo visível = linhas 2..12 da grade => fica centrado no quadro 16x16
  const buf = Buffer.alloc(size * size * 4)
  const put = (x: number, y: number, hex: string) => {
    const c = [5, 3, 1].map((i) => parseInt(hex.slice(i, i + 2), 16)) // B, G, R
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = (((y + top) * scale + dy) * size + x * scale + dx) * 4
      if (o < 0 || o + 3 >= buf.length) continue
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255
    }
  }
  BODY.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(x, y, skin.bodyRows?.[y] ?? (ch === 'D' ? skin.palette.shade : skin.palette.body)) }))
  for (const [x0, y0, w, h] of EYES) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, skin.palette.eye)
  return { buf, size }
}
