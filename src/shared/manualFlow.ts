import type { AgentStatus, TeamAgent } from './teams'

// Equipe manual: textos que o usuário COPIA e cola nos terminais (o pet nunca digita em terminal).
// Montados só com nome de exibição, slug validado e branch detectada.

const REPORT_ONLY = new Set(['seguranca', 'design']) // por padrão só leem e escrevem relatório

/** Instrução para colar na sessão do líder (pasta principal, branch atual). */
export function leaderInstruction(agents: TeamAgent[], branch: string): string {
  const team = agents.filter((a) => a.id !== 'lider')
  const reportOnly = team.filter((a) => REPORT_ONLY.has(a.kind)).map((a) => a.label)
  return [
    'Você é o LÍDER desta equipe. Você não implementa código: coordena, delega e revisa. Siga o CLAUDE.md (seção "Regras da equipe").',
    '',
    `Branch principal: ${branch}. Equipe (função · identificador, que também é o nome da branch):`,
    ...team.map((a) => `- ${a.label} · ${a.slug}`),
    '',
    '1. Escreva UMA tarefa por agente em .equipe/tarefas/<identificador>.md, com: escopo, arquivos que o agente pode mexer e,',
    '   quando houver back e front, o contrato entre as partes (rotas, campos, formatos), igual nos dois lados.',
    ...(reportOnly.length ? [`   ${reportOnly.join(' e ')}: por padrão só leem e escrevem relatório, sem editar código, a menos que você peça.`] : []),
    `2. Quando eu trouxer uma entrega, revise o diff (git diff ${branch}..<identificador>), não só o resumo.`,
    '3. Grave o veredito em .equipe/revisoes/<identificador>.md citando o hash do commit revisado:',
    '   "aprovado <hash>" ou "ajustes <hash>: <o que corrigir>".',
    `4. Merge na ${branch} só depois que eu confirmar.`
  ].join('\n')
}

/** Tarefa para colar no terminal do agente. */
export function taskPrompt(a: Pick<TeamAgent, 'label' | 'slug'>, task: string): string {
  return `Você é o agente de ${a.label}, na branch ${a.slug}. Siga o CLAUDE.md.\n\n${task.trim()}`
}

/** Texto para colar na sessão do líder quando um agente entrega. */
export function deliveryMessage(a: Pick<TeamAgent, 'label' | 'slug'>, d: { hash: string; subject: string }, base: string): string {
  return [
    `Entrega de ${a.label} (branch ${a.slug}), commit ${d.hash}: ${d.subject}`,
    `Revise o diff com git diff ${base}..${a.slug}, não só o resumo.`,
    `Grave o veredito em .equipe/revisoes/${a.slug}.md citando o hash: "aprovado ${d.hash.slice(0, 12)}" ou "ajustes ${d.hash.slice(0, 12)}: <o que corrigir>".`
  ].join('\n')
}

// ---------- revisão ----------
export type Verdict = { kind: 'approved' | 'changes'; hash: string; notes: string }
const VERDICT = /^[ \t>*-]*(aprovado|ajustes)[ \t]+([0-9a-f]{7,40})\b[ \t]*:?[ \t]*(.*)$/im

/** Veredito do líder: 1ª linha "aprovado <hash>" ou "ajustes <hash>: ...". Ajustes levam o resto do arquivo. */
export function parseVerdict(text: string | null): Verdict | null {
  const m = text ? VERDICT.exec(text) : null
  if (!m) return null
  const kind = m[1].toLowerCase() === 'aprovado' ? 'approved' : 'changes'
  const rest = text!.slice(m.index + m[0].length).trim()
  return { kind, hash: m[2].toLowerCase(), notes: kind === 'changes' ? [m[3].trim(), rest].filter(Boolean).join('\n').slice(0, 4000) : '' }
}

/** Texto para colar no terminal do agente quando o líder pede ajustes. */
export function adjustmentsPrompt(a: Pick<TeamAgent, 'label' | 'slug'>, v: Verdict): string {
  return `Ajustes pedidos pelo líder para ${a.label} (branch ${a.slug}, commit ${v.hash.slice(0, 12)}):\n\n${v.notes}\n\nCorrija e faça um novo commit "ENTREGA: <resumo curto>".`
}

type Del = { hash: string; merged: boolean; hasBase: boolean }
/**
 * Estado de cada card no fluxo. Atividade ao vivo (trabalhando / precisa de você) sempre vence.
 * Veredito só vale se o hash for o da ENTREGA mais recente (entrega mais nova => volta a "Entregue para revisão").
 * Todos aprovados => líder "Pronto para integrar"; entregas aprovadas já na base => "Integrado";
 * Testes, depois da integração, fica "Validando integração" até entregar algo que já contém a base.
 */
export function teamFlow(agents: TeamAgent[], live: (a: TeamAgent) => AgentStatus,
  deliveries: Record<string, Del>, verdicts: Record<string, Verdict>): Map<string, AgentStatus> {
  const out = new Map<string, AgentStatus>()
  const busy = (st: AgentStatus) => st === 'working' || st === 'needs_you'
  const team = agents.filter((a) => a.id !== 'lider')
  const review = (a: TeamAgent): AgentStatus | null => {
    const d = deliveries[a.id], v = verdicts[a.id]
    if (!d) return null
    if (v && d.hash.startsWith(v.hash)) return v.kind === 'approved' ? 'approved' : 'changes'
    return 'delivered'
  }
  const allApproved = team.length > 0 && team.every((a) => review(a) === 'approved')
  const others = team.filter((a) => a.kind !== 'testes')
  const integrated = others.length > 0 && others.every((a) => review(a) === 'approved' && deliveries[a.id]?.merged)
  for (const a of agents) {
    const l = live(a)
    if (busy(l)) { out.set(a.id, l); continue }
    if (a.id === 'lider') { out.set(a.id, integrated ? 'integrated' : allApproved ? 'ready' : l); continue }
    if (a.kind === 'testes' && integrated && !deliveries[a.id]?.hasBase) { out.set(a.id, 'validating'); continue }
    out.set(a.id, review(a) ?? l)
  }
  return out
}
