import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { lineDiff } from '../shared/lineDiff'
import { SLUG, slugify, type TeamAgent } from '../shared/teams'
import type { ManualProject } from '../shared/types'
import { parseVerdict } from '../shared/manualFlow'
import { currentBranch, isAncestor, latestDelivery, SAFE_BRANCH } from './gitRead'

// Equipe manual: preparação do projeto. O pet só ESCREVE em <projeto>/CLAUDE.md e <projeto>/.gitignore, e só depois
// de você ver a diferença e confirmar (token da prévia). Comandos de worktree são só copiados, nunca executados.

export const RULES_HEADING = '# Regras da equipe'

/** Regras da equipe; `branch` = branch atual da pasta do líder (detectada, não fixa em "main"). */
export function rulesTemplate(branch: string): string {
  return [
    RULES_HEADING,
    `- Agentes: nunca trabalhem na ${branch} nem façam merge. Só o líder integra, após confirmação do usuário.`,
    '- Mexa só nos arquivos da sua função, descritos na sua tarefa.',
    '- Siga o contrato da API exatamente (rotas, campos, formatos).',
    '- Ao terminar: commit com mensagem "ENTREGA: <resumo curto>".',
    '- Nunca coloque chaves, senhas ou tokens no código.',
    '- Se precisar mudar algo de outra função, pare e avise no resumo.',
    ''
  ].join('\n')
}

const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10)
const eolOf = (s: string) => (s.includes(CRLF) ? CRLF : NL)
const withEol = (s: string, eol: string) => (eol === NL ? s : s.split(NL).join(eol))

/** CLAUDE.md -> conteúdo novo (cria ou ADICIONA a seção no fim, sem apagar nada). null = já tem a seção. */
export function withRules(cur: string | null, branch: string): string | null {
  if (cur === null) return rulesTemplate(branch)
  if (cur.split(/\r?\n/).some((l) => l.trim() === RULES_HEADING)) return null
  const eol = eolOf(cur)
  const sep = cur.length === 0 ? '' : cur.endsWith(eol) ? eol : eol + eol
  return cur + sep + withEol(rulesTemplate(branch), eol)
}

/** .gitignore -> conteúdo novo com ".equipe/" no fim. null = já ignora a pasta. */
export function withGitignore(cur: string | null): string | null {
  if (cur !== null && cur.split(/\r?\n/).some((l) => ['.equipe', '.equipe/', '/.equipe', '/.equipe/'].includes(l.trim()))) return null
  if (cur === null) return '.equipe/' + NL
  const eol = eolOf(cur)
  return cur + (cur.length && !cur.endsWith(eol) ? eol : '') + '.equipe/' + eol
}

/** Nome da pasta do projeto como slug (vai em nome de pasta de worktree). */
export const projectSlug = (projectPath: string) => slugify(path.basename(projectPath)) || 'projeto'
/** Pasta do worktree de um agente: irmã do projeto, "<projeto>-<slug>". */
export const worktreePath = (projectPath: string, slug: string) => path.join(path.dirname(projectPath), `${projectSlug(projectPath)}-${slug}`)

/** Comandos para o PowerShell, montados SÓ com slugs validados; caminho da pasta entre aspas simples (literal). */
export function worktreeCommands(projectPath: string, agents: Pick<TeamAgent, 'id' | 'slug'>[]): string {
  const lines = [`Set-Location -LiteralPath '${projectPath.replace(/'/g, "''")}'`]
  for (const a of agents) {
    if (a.id === 'lider') continue
    if (!SLUG.test(a.slug)) throw new Error(`Identificador inválido: ${a.slug}`)
    lines.push(`git worktree add ..\\${projectSlug(projectPath)}-${a.slug} -b ${a.slug}`)
  }
  return lines.join(CRLF)
}

/** Pasta existe e é um worktree git (tem o ARQUIVO .git, não a pasta). */
export function isWorktree(dir: string): boolean {
  try { return fs.lstatSync(dir).isDirectory() && fs.lstatSync(path.join(dir, '.git')).isFile() } catch { return false }
}

// ---------- edição com prévia + confirmação (mesmo esquema da instalação dos hooks) ----------
const MAX_EDIT = 512 * 1024
const fingerprint = (raw: string | null) => createHash('sha256').update(raw ?? '(arquivo ausente)').digest('hex')

function readTarget(file: string): string | null {
  let st: fs.Stats
  try { st = fs.lstatSync(file) } catch { return null }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${path.basename(file)} não é um arquivo comum; nada foi alterado`)
  if (st.size > MAX_EDIT) throw new Error(`${path.basename(file)} grande demais para editar aqui`)
  return fs.readFileSync(file, 'utf8')
}

export function previewEdit(file: string, next: (cur: string | null) => string | null) {
  const cur = readTarget(file)
  const out = next(cur)
  const d = out === null ? { text: '', changes: 0 } : lineDiff(cur ?? '', out)
  return { path: file, exists: cur !== null, diff: d.text, changes: d.changes, token: fingerprint(cur) }
}

/** Grava só se o arquivo continua igual ao da prévia (token). Escrita atômica (tmp + rename). */
export function applyEdit(file: string, next: (cur: string | null) => string | null, token: string): boolean {
  const cur = readTarget(file)
  if (fingerprint(cur) !== token) throw new Error(`${path.basename(file)} mudou depois da prévia; nada foi gravado. Gere a prévia de novo.`)
  const out = next(cur)
  if (out === null) return false
  const tmp = file + '.claude-pet.tmp'
  // tmp que já exista (sobra de queda ou link plantado) sai antes; 'wx' cria do zero e nunca segue link
  fs.rmSync(tmp, { force: true })
  fs.writeFileSync(tmp, out, { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(tmp, file)
  return true
}

// ---------- .equipe/ (tarefas e revisões escritas pelo líder): SÓ leitura ----------
export const EQUIPE_MAX = 32 * 1024 // arquivo maior que isso é ignorado
export const EQUIPE_TEXT_MAX = 8000 // o que vai para a tela/cópia
/**
 * Lê <projeto>/.equipe/<tarefas|revisoes>/<slug>.md. Caminho montado só com slug validado; recusa link simbólico
 * (no arquivo, na pasta e em .equipe) e confere que o caminho real continua dentro de .equipe. null = não há.
 */
export function readEquipe(projectPath: string, sub: 'tarefas' | 'revisoes', slug: string): string | null {
  if (!SLUG.test(slug)) return null
  try {
    const base = path.join(projectPath, '.equipe'), dir = path.join(base, sub), file = path.join(dir, `${slug}.md`)
    for (const d of [base, dir]) { const st = fs.lstatSync(d); if (st.isSymbolicLink() || !st.isDirectory()) return null }
    const st = fs.lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile() || st.size > EQUIPE_MAX) return null
    const real = fs.realpathSync.native(file), realBase = fs.realpathSync.native(base)
    if (!real.toLowerCase().startsWith(realBase.toLowerCase() + path.sep)) return null
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').slice(0, EQUIPE_TEXT_MAX)
  } catch { return null }
}

/** Estado da preparação (lido a cada ciclo; só leitura). */
export async function projectInfo(projectPath: string, agents: TeamAgent[]): Promise<ManualProject> {
  const branch = await currentBranch(projectPath)
  const read = (f: string) => { try { return readTarget(path.join(projectPath, f)) } catch { return null } }
  const claude = read('CLAUDE.md'), ignore = read('.gitignore')
  return {
    path: projectPath, name: path.basename(projectPath), branch,
    claudeMd: claude === null ? 'missing' : withRules(claude, branch ?? 'main') === null ? 'ok' : 'no-rules',
    gitignore: withGitignore(ignore) === null ? 'ok' : ignore === null ? 'missing' : 'no-entry',
    worktrees: Object.fromEntries(agents.filter((a) => a.id !== 'lider').map((a) => {
      const p = worktreePath(projectPath, a.slug)
      return [a.id, { path: p, ready: isWorktree(p) }]
    })),
    deliveries: Object.fromEntries((await Promise.all(agents.filter((a) => a.id !== 'lider').map(async (a) => {
      if (!branch) return []
      const base = `refs/heads/${branch}`
      const d = (await latestDelivery(projectPath, branch, a.slug)) ?? (a.lastDelivery ? { ...a.lastDelivery, stat: '' } : null)
      if (!d) return []
      return [[a.id, { ...d, merged: await isAncestor(projectPath, d.hash, base), hasBase: await isAncestor(projectPath, base, d.hash) }] as const]
    }))).flat()),
    verdicts: Object.fromEntries(agents.filter((a) => a.id !== 'lider').flatMap((a) => {
      const v = parseVerdict(readEquipe(projectPath, 'revisoes', a.slug))
      return v ? [[a.id, v]] : []
    })),
    tasks: Object.fromEntries(agents.filter((a) => a.id !== 'lider').flatMap((a) => {
      const t = readEquipe(projectPath, 'tarefas', a.slug)
      return t && t.trim() ? [[a.id, t]] : []
    }))
  }
}

export { SAFE_BRANCH }
