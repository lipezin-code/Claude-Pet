import { z } from 'zod'
import type { PetState, Session } from './types'

// Equipe manual -> Agente (posição fixa + função editável) -> Sessão (id) -> Worktree (pasta).
// O estado do agente é DERIVADO da sessão vinculada (nada de estado paralelo a sincronizar).
// Posição (slot) é a identidade do card: a skin pertence a ela, então trocar a função não troca a cor.
export const SLOTS = ['lider', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] as const // 7 = uma por função da lista
export type Slot = (typeof SLOTS)[number]
export const SLOT_LABEL: Record<Slot, string> = { lider: 'Líder', a1: 'Agente 1', a2: 'Agente 2', a3: 'Agente 3', a4: 'Agente 4', a5: 'Agente 5', a6: 'Agente 6', a7: 'Agente 7' }
export const AGENT_SLOTS = SLOTS.filter((s): s is Exclude<Slot, 'lider'> => s !== 'lider')
export const MAX_AGENTS = AGENT_SLOTS.length // além do líder
export const LEAD_SKIN = 'dourado' // padrão do líder enquanto você não escolher outra
export const TEAM_NAME = /^[A-Za-z0-9-]{1,40}$/

// Funções da lista; "custom" = Personalizada (nome livre)
export const KINDS = ['backend', 'frontend', 'testes', 'banco', 'design', 'integracoes', 'seguranca', 'custom'] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, string> = {
  backend: 'Back-end', frontend: 'Front-end', testes: 'Testes', banco: 'Banco de dados', design: 'Design',
  integracoes: 'Integrações/API', seguranca: 'Segurança', custom: 'Personalizada'
}
export const TEMPLATES: { id: string; label: string; kinds: Exclude<Kind, 'custom'>[] }[] = [
  { id: 'landing', label: 'Landing page', kinds: ['frontend', 'design', 'seguranca'] },
  { id: 'saas', label: 'SaaS', kinds: ['backend', 'frontend', 'banco', 'testes'] },
  { id: 'ecommerce', label: 'E-commerce', kinds: ['backend', 'frontend', 'integracoes', 'seguranca'] }
]

// slug: usado em branch, pasta e arquivo (o nome de exibição nunca é)
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SLUG_MAX = 30
const RESERVED = new Set(['main', 'master', 'head', 'lider'])
export const LABEL_MAX = 40

/** Nome de exibição -> slug (sem acento, minúsculas, números e hífen). "" se não sobrar nada. */
export function slugify(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '')
}

const SID = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)
export const TeamAgentSchema = z.object({
  id: z.enum(SLOTS),
  kind: z.union([z.enum(KINDS), z.literal('lider')]),
  label: z.string().min(1).max(LABEL_MAX),
  slug: z.string().max(SLUG_MAX).regex(SLUG),
  sessionId: SID.optional(),
  worktree: z.object({ path: z.string().max(1024) }).optional(),
  // última entrega vista (depois do merge, base..branch fica vazio; sem isto "Aprovado/Integrado" sumiriam)
  lastDelivery: z.object({ hash: z.string().regex(/^[0-9a-f]{40}$/), subject: z.string().max(120), at: z.number() }).optional()
})
export const TeamSchema = z.object({
  id: z.string().regex(TEAM_NAME),
  name: z.string().regex(TEAM_NAME),
  goal: z.string().max(300),
  projectPath: z.string().max(1024).optional(), // pasta do líder (escolhida no seletor, validada no main)
  agents: z.array(TeamAgentSchema).min(1).max(SLOTS.length)
})
export const TeamsFile = z.object({ teams: z.array(TeamSchema).max(20) })
export type TeamAgent = z.infer<typeof TeamAgentSchema>
export type Team = z.infer<typeof TeamSchema>

export const LEADER: TeamAgent = { id: 'lider', kind: 'lider', label: 'Líder', slug: 'lider' }
const agentOfKind = (id: Exclude<Slot, 'lider'>, kind: Exclude<Kind, 'custom'>): TeamAgent => ({ id, kind, label: KIND_LABEL[kind], slug: slugify(KIND_LABEL[kind]) })
export const newTeam = (): Team => ({ id: 'equipe', name: 'equipe', goal: '', agents: [LEADER, agentOfKind('a1', 'backend'), agentOfKind('a2', 'frontend')] })

/** Linha do editor de equipe (o que o usuário escolhe). `id` ausente = agente novo. */
export interface RosterRow { id?: Exclude<Slot, 'lider'>; kind: Kind; label: string }

/**
 * Valida a equipe montada (cliente e main usam a MESMA função). Gera o slug do nome; recusa vazio, reservado
 * e repetido. Agente existente mantém a posição (e a skin); novo pega a 1ª posição livre.
 */
export function buildRoster(rows: RosterRow[]): { ok: true; agents: TeamAgent[] } | { ok: false; error: string; row?: number } {
  if (rows.length < 1) return { ok: false, error: 'A equipe precisa de pelo menos 1 agente além do líder.' }
  if (rows.length > MAX_AGENTS) return { ok: false, error: `No máximo ${MAX_AGENTS} agentes além do líder.` }
  const used = new Set(rows.flatMap((r) => (r.id && AGENT_SLOTS.includes(r.id) ? [r.id] : [])))
  if (used.size !== rows.filter((r) => r.id).length) return { ok: false, error: 'Posição repetida.' }
  const free = AGENT_SLOTS.filter((s) => !used.has(s))
  const slugs = new Set<string>()
  const agents: TeamAgent[] = [LEADER]
  for (const [i, r] of rows.entries()) {
    if (!KINDS.includes(r.kind)) return { ok: false, error: 'Função inválida.', row: i }
    const label = r.label.trim().slice(0, LABEL_MAX)
    if (!label) return { ok: false, error: 'Dê um nome à função.', row: i }
    const slug = slugify(label)
    if (!slug) return { ok: false, error: `"${label}" não gera um identificador (use letras ou números).`, row: i }
    if (RESERVED.has(slug)) return { ok: false, error: `"${slug}" é reservado; escolha outro nome.`, row: i }
    if (slugs.has(slug)) return { ok: false, error: `Duas funções geram o mesmo identificador "${slug}".`, row: i }
    slugs.add(slug)
    agents.push({ id: r.id ?? free.shift()!, kind: r.kind, label, slug })
  }
  return { ok: true, agents }
}

export type AgentStatus = 'working' | 'waiting' | 'needs_you' | 'done' | 'stalled' | 'validated' | 'ended' | 'unbound' | 'unknown'
  | 'delivered' | 'changes' | 'approved' | 'validating' | 'ready' | 'integrated' // fluxo da equipe manual

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  working: 'Trabalhando', waiting: 'Aguardando', needs_you: 'Precisa de você', done: 'Concluído',
  stalled: 'Parou de responder', validated: 'Tarefa validada', ended: 'Sessão encerrada', unbound: 'Sem sessão', unknown: 'Desconhecido',
  delivered: 'Entregue para revisão', changes: 'Ajustes pedidos', approved: 'Aprovado', validating: 'Validando integração',
  ready: 'Pronto para integrar', integrated: 'Integrado'
}
// Líder (sênior): só delega, revisa e decide; nunca escreve código. "Trabalhando" dele = revisando.
export const LEAD_STATUS_LABEL: Record<AgentStatus, string> = { ...AGENT_STATUS_LABEL, working: 'Revisando', needs_you: 'Decisão com você' }
export const statusLabel = (lead: boolean, st: AgentStatus) => (lead ? LEAD_STATUS_LABEL : AGENT_STATUS_LABEL)[st]
export const AGENT_MASCOT: Record<AgentStatus, PetState> = {
  working: 'WORKING', waiting: 'IDLE', needs_you: 'WAITING_PERMISSION', done: 'COMPLETED',
  stalled: 'UNKNOWN', validated: 'IDLE', ended: 'DISCONNECTED', unbound: 'DISCONNECTED', unknown: 'UNKNOWN', delivered: 'COMPLETED',
  changes: 'ERROR', approved: 'COMPLETED', validating: 'THINKING', ready: 'WAITING_PERMISSION', integrated: 'IDLE'
}
/** Conta como "ativo" no indicador do pet: sessão viva e tarefa ainda não validada. */
export const isActive = (st: AgentStatus) => ['working', 'waiting', 'needs_you', 'done', 'stalled', 'delivered', 'changes', 'validating', 'ready'].includes(st)


// eventos que dizem em que ponto da resposta a sessão estava (Notification/Subagent/Task são informativos)
const MID = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest'])
const MARK = new Set([...MID, 'Stop', 'StopFailure', 'SessionStart', 'SessionEnd'])
const lastMark = (s: Session) => [...s.log].reverse().find((l) => MARK.has(l.event))

/**
 * Estado do agente a partir da sessão. "Parou de responder" = sessão estava NO MEIO de uma resposta e ficou
 * sem eventos (o tick a pôs em UNKNOWN). "Tarefa validada" = só a sua marcação; atividade nova vence.
 */
export function agentStatus(s: Session | undefined, validated: boolean): AgentStatus {
  if (!s) return 'unbound'
  if (s.state === 'WAITING_PERMISSION' || s.state === 'ERROR') return 'needs_you'
  if (s.state === 'THINKING' || s.state === 'WORKING') return 'working'
  if (validated) return 'validated'
  if (s.liveness === 'ended') return 'ended'
  const last = lastMark(s)
  if (s.state === 'UNKNOWN' && last && MID.has(last.event)) return 'stalled'
  if (s.state === 'COMPLETED' || last?.event === 'Stop') return 'done'
  return 'waiting'
}
/** Sessão + estado do agente. Fonte única para a janela, o indicador do pet e as notificações. */
export function resolveAgent(a: TeamAgent, sessions: Session[]): { s?: Session; st: AgentStatus } {
  const s = a.sessionId ? sessions.find((x) => x.id === a.sessionId) : undefined
  return { s, st: agentStatus(s, false) }
}

/** Subagentes da sessão (só contador; não são membros da equipe). `skip` = tipos que são membros de Agent Team. */
export function subCount(s: Session | undefined, skip: ReadonlySet<string> = new Set()): { total: number; active: number } {
  const l = (s?.subs ?? []).filter((x) => !skip.has(x.type))
  return { total: l.length, active: l.filter((x) => x.state === 'working' || x.state === 'needs_you').length }
}

/** Identifica UMA conclusão (p/ o "!" do mascote aparecer uma vez só). */
export const doneKey = (s: Session) => `${s.id}:${lastMark(s)?.ts ?? s.stateSince}`

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** Agente dono da sessão (por id). */
export function agentOf(teams: Team[], sessionId: string): { team: Team; agent: TeamAgent } | null {
  for (const team of teams) for (const agent of team.agents) if (agent.sessionId === sessionId) return { team, agent }
  return null
}

/**
 * Revínculo pela pasta do worktree: agente com pasta conhecida e sem sessão viva pega a sessão viva que roda
 * naquela pasta, só se houver EXATAMENTE uma e ela não for de outro agente (pasta compartilhada = ambíguo, não mexe).
 * Devolve null se nada mudou.
 */
export function autoBind(teams: Team[], sessions: Session[]): Team[] | null {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const taken = new Set(teams.flatMap((t) => t.agents.flatMap((a) => (a.sessionId ? [a.sessionId] : []))))
  let changed = false
  const out = teams.map((t) => ({
    ...t,
    agents: t.agents.map((a) => {
      const cur = a.sessionId ? byId.get(a.sessionId) : undefined
      if (!a.worktree || (cur && cur.liveness !== 'ended')) return a
      const c = sessions.filter((s) => s.liveness !== 'ended' && !taken.has(s.id) && s.cwd && samePath(s.cwd, a.worktree!.path))
      if (c.length !== 1) return a
      taken.add(c[0].id); changed = true
      return { ...a, sessionId: c[0].id }
    })
  }))
  return changed ? out : null
}

/**
 * Dá a cada item uma skin sem repetir. Mantém as já escolhidas (se válidas e ainda não usadas);
 * os demais recebem a próxima livre na ordem de `skinIds`. Mais itens que skins: recomeça (só então repete).
 */
export function assignSkins(items: { id: string; skinId?: string }[], skinIds: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const a of items) if (a.skinId && skinIds.includes(a.skinId) && !used.has(a.skinId)) { out.set(a.id, a.skinId); used.add(a.skinId) }
  let i = 0
  for (const a of items) {
    if (out.has(a.id)) continue
    const free = skinIds.find((s) => !used.has(s)) ?? skinIds[i++ % Math.max(1, skinIds.length)]
    if (free === undefined) continue
    out.set(a.id, free); used.add(free)
  }
  return out
}

/** Skin de cada posição a partir do que foi salvo nas Configurações (inválidas/duplicadas viram automáticas). */
export function slotSkins(saved: Partial<Record<Slot, string>>, skinIds: string[]): Map<Slot, string> {
  const leadDefault = !Object.values(saved).includes(LEAD_SKIN) ? LEAD_SKIN : undefined
  return assignSkins(SLOTS.map((r) => ({ id: r, skinId: saved[r] ?? (r === 'lider' ? leadDefault : undefined) })), skinIds) as Map<Slot, string>
}

/** Troca a skin de uma posição; se outra já a usa, ela fica com a antiga (sem repetir). Devolve o mapa completo. */
export function swapSkin(saved: Partial<Record<Slot, string>>, slot: Slot, skinId: string, skinIds: string[]): Record<Slot, string> {
  const cur = slotSkins(saved, skinIds)
  const old = cur.get(slot)!
  return Object.fromEntries(SLOTS.map((r) => [r, r === slot ? skinId : cur.get(r) === skinId ? old : cur.get(r)!])) as Record<Slot, string>
}

// ---- migração da versão com funções fixas (teams.json e settings.teamSkins) ----
const OLD_ROLE: Record<string, { id: Slot; kind: TeamAgent['kind']; label: string }> = {
  lider: { id: 'lider', kind: 'lider', label: 'Líder' }, backend: { id: 'a1', kind: 'backend', label: 'Back-end' },
  frontend: { id: 'a2', kind: 'frontend', label: 'Front-end' }, testes: { id: 'a3', kind: 'testes', label: 'Testes' },
  revisao: { id: 'a4', kind: 'custom', label: 'Revisão' } // Revisão saiu da lista: vira Personalizada
}
/** Agente no formato antigo ({ role, ... }) -> novo, mantendo sessão e pasta. Formato novo passa intacto. */
export function migrateAgent(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw.role !== 'string' || raw.id) return raw
  const m = OLD_ROLE[raw.role]
  if (!m) return raw
  const wt = raw.worktree as { path?: unknown } | undefined
  return { id: m.id, kind: m.kind, label: m.label, slug: m.id === 'lider' ? 'lider' : slugify(m.label), sessionId: raw.sessionId,
    worktree: wt && typeof wt.path === 'string' ? { path: wt.path } : undefined }
}
/** settings.teamSkins antigo (por função) -> por posição. */
export function migrateTeamSkins(saved: Record<string, unknown> | undefined): Partial<Record<Slot, string>> {
  const out: Partial<Record<Slot, string>> = {}
  for (const [k, v] of Object.entries(saved ?? {})) {
    if (typeof v !== 'string') continue
    const slot = (SLOTS as readonly string[]).includes(k) ? (k as Slot) : OLD_ROLE[k]?.id
    if (slot && !out[slot]) out[slot] = v
  }
  return out
}
