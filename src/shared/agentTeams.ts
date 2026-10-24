import { z } from 'zod'
import { assignSkins, type AgentStatus } from './teams'
import type { Session } from './types'

// Agent Teams do Claude Code (experimental), lidas de ~/.claude/teams/<equipe>/config.json (só leitura).
// Formato conferido num config.json real (v2.1.310): name, createdAt, leadAgentId, leadSessionId, members[].
// O elo equipe -> líder é `leadSessionId` (id completo da sessão). Eventos dos membros chegam na sessão do
// líder com agent_type = nome do membro. O campo `prompt` dos membros NUNCA é lido para cá.
export const UNKNOWN = 'desconhecido'
export const MEMBER_NAME_MAX = 40

export const AgentTeamMemberSchema = z.object({
  name: z.string().max(MEMBER_NAME_MAX),
  agentType: z.string().max(64),
  color: z.string().max(20),
  joinedAt: z.number()
})
export const AgentTeamSchema = z.object({
  id: z.string().max(80),
  leadSessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  members: z.array(AgentTeamMemberSchema).max(20),
  ambiguous: z.array(z.string().max(MEMBER_NAME_MAX)).max(20), // nome = tipo de subagente conhecido: estado desconhecido
  ended: z.boolean(), // pasta da equipe sumiu (o Claude Code a apaga quando a sessão do líder termina)
  seenAt: z.number()
})
export type AgentTeamMember = z.infer<typeof AgentTeamMemberSchema>
export type AgentTeam = z.infer<typeof AgentTeamSchema>

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : UNKNOWN)

/**
 * config.json não confiável -> só os campos usados. Tolerante: campo ausente/estranho vira "desconhecido";
 * sem leadSessionId válido não há como ligar ao líder => null. O líder (team-lead) não vira membro.
 */
export function parseTeamConfig(raw: string, folder: string): { id: string; leadSessionId: string; members: AgentTeamMember[] } | null {
  let j: unknown
  try { j = JSON.parse(raw) } catch { return null }
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const lead = typeof o.leadSessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(o.leadSessionId) ? o.leadSessionId : null
  if (!lead) return null
  const list = Array.isArray(o.members) ? o.members.slice(0, 21) : []
  const members = list.flatMap((m): AgentTeamMember[] => {
    if (!m || typeof m !== 'object') return []
    const r = m as Record<string, unknown>
    const name = str(r.name, MEMBER_NAME_MAX), agentType = str(r.agentType, 64)
    if (name === 'team-lead' || agentType === 'team-lead') return []
    const color = typeof r.color === 'string' && /^[a-z]{1,20}$/.test(r.color) ? r.color : UNKNOWN
    return [{ name, agentType, color, joinedAt: typeof r.joinedAt === 'number' && Number.isFinite(r.joinedAt) ? r.joinedAt : 0 }]
  }).slice(0, 20)
  return { id: str(o.name, 80) === UNKNOWN ? folder.slice(0, 80) : str(o.name, 80), leadSessionId: lead, members }
}

/** Encerrada: pasta sumiu OU a sessão do líder já terminou (pasta esquecida quando o Claude Code fecha à força). */
export const teamEnded = (t: AgentTeam, lead: Session | undefined) => t.ended || lead?.liveness === 'ended'

/** Membro -> estado. Ligação por agent_type = nome, dentro da sessão do líder. Ambíguo/sem dado => desconhecido. */
export function memberStatus(t: AgentTeam, m: AgentTeamMember, lead: Session | undefined): AgentStatus {
  if (teamEnded(t, lead)) return 'ended'
  if (m.name === UNKNOWN || t.ambiguous.includes(m.name) || !lead) return 'unknown'
  const subs = (lead.subs ?? []).filter((x) => x.type === m.name).sort((a, b) => b.lastEventAt - a.lastEventAt)
  const taskDone = !!lead.teamTasks?.[m.name]?.done // TaskCompleted com o nome dele
  if (!subs.length) return taskDone ? 'done' : 'waiting' // entrou na equipe, ainda sem atividade
  const st = subs[0].state
  if (st === 'working' || st === 'needs_you' || st === 'stalled') return st
  return st === 'idle' && !taskDone ? 'waiting' : 'done'
}

/** Nomes que são membros (p/ não contar como subagente no card do líder). */
export const memberNames = (t: AgentTeam) => new Set(t.members.map((m) => m.name))

// cor do config.json -> skin parecida (lista fechada; a cor nunca vai para CSS)
const COLOR_SKIN: Record<string, string> = {
  blue: 'azul', cyan: 'azul', green: 'verde', purple: 'roxo', pink: 'rosa', red: 'vermelho',
  yellow: 'dourado', orange: 'classico', white: 'branco', black: 'dark', gray: 'dark', grey: 'dark'
}
/** Skin de cada membro, sem repetir na equipe: a do líder fica reservada; preferência pela cor do config. */
export function memberSkins(t: AgentTeam, skinIds: string[], leadSkin: string): Map<string, string> {
  const items = [{ id: '\u0000lead', skinId: leadSkin }, ...t.members.map((m) => ({ id: m.name, skinId: COLOR_SKIN[m.color] }))]
  return assignSkins(items, skinIds)
}
