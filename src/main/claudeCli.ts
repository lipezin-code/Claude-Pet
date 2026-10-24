import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Marcadores que o Claude Code põe nos processos que ele mesmo cria. Se o pet nasceu dentro de uma sessão
 * (ex.: instalado/testado por ela), herda estes e o `claude` que ele abrir se acha "sessão filha":
 * sem transcrição, fora do --resume, com ID de sessão do pai. Só estes saem; ANTHROPIC_*, CLAUDE_CODE_USE_*,
 * CLAUDE_EFFORT, proxy etc. ficam. Conferidos no binário 2.1.309 e em code.claude.com/docs/en/env-vars.
 */
export const CLAUDE_MARKERS = [
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'AI_AGENT'
]
const isMarker = (k: string) => CLAUDE_MARKERS.includes(k.toUpperCase()) // env do Windows ignora maiúsculas

/** Cópia do ambiente sem os marcadores. Nunca registra valores. */
export function cleanEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !isMarker(k)))
}
/**
 * Ambiente do terminal que o pet abre. `agentTeams`: liga as Agent Teams (experimental) SÓ nessa janela;
 * o settings.json do Claude Code não é tocado e o `claude` aberto de outro jeito continua igual.
 */
export function terminalEnv(opts: { agentTeams?: boolean } = {}, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const e = cleanEnv(env)
  if (opts.agentTeams) e.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  return e
}

/** Só os NOMES dos marcadores presentes (diagnóstico). */
export const markerNames = (env: NodeJS.ProcessEnv = process.env) => Object.keys(env).filter(isMarker).sort()

export async function findClaude(): Promise<{ found: boolean; path?: string; version?: string }> {
  try {
    const { stdout } = await exec('where.exe', ['claude'], { windowsHide: true, timeout: 5000 })
    const p = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    if (!p) return { found: false }
    let version: string | undefined
    try { version = (await exec(p, ['--version'], { windowsHide: true, timeout: 8000, env: cleanEnv() })).stdout.trim() } catch { /* ignora */ }
    return { found: true, path: p, version }
  } catch { return { found: false } }
}

export async function hasWindowsTerminal(): Promise<boolean> {
  try { await exec('where.exe', ['wt'], { windowsHide: true, timeout: 5000 }); return true } catch { return false }
}

/** Caracteres que o wt.exe (';') ou o cmd.exe tratam como sintaxe. Recusa em vez de escapar. */
const UNSAFE_CWD = /[;&|<>^%"`\r\n]/

export function validateCwd(cwd: string): string | null {
  if (!cwd || UNSAFE_CWD.test(cwd)) return 'Caminho contém caracteres não suportados'
  try { if (!fs.statSync(cwd).isDirectory()) return 'Não é uma pasta' } catch { return 'Pasta não existe' }
  return null
}

export function buildClaudeArgs(resumeId?: string): string[] {
  return resumeId ? ['--resume', resumeId] : []
}

/** Abre o Windows Terminal na pasta do projeto rodando `claude`. Exec-form: sem shell, sem injeção. */
export async function openClaudeTerminal(cwd: string, resumeId?: string, opts: { agentTeams?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const bad = validateCwd(cwd)
  if (bad) return { ok: false, error: bad }
  if (resumeId && !SESSION_ID_RE.test(resumeId)) return { ok: false, error: 'ID de sessão inválido' }
  const cli = await findClaude()
  if (!cli.found) return { ok: false, error: 'Claude Code CLI não encontrado no PATH' }
  const args = buildClaudeArgs(resumeId)
  const [file, fargs] = (await hasWindowsTerminal())
    ? ['wt.exe', ['-d', cwd, 'claude', ...args]]
    : ['cmd.exe', ['/c', 'start', '', '/D', cwd, 'claude', ...args]]
  try {
    // o wt.exe repassa à aba o ambiente de quem o chama (testado: janela nova e aba em janela já aberta)
    const child = spawn(file, fargs, { detached: true, stdio: 'ignore', windowsHide: false, env: terminalEnv(opts) })
    child.on('error', () => {})
    child.unref()
    return { ok: true }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
}

// Claude Desktop: instalador antigo (exe em %LOCALAPPDATA%) ou app da Microsoft Store (MSIX). O exe da Store fica em
// WindowsApps (protegido, não executável direto): abre pelo AppUserModelID via explorer.exe, que é o caminho suportado.
export const DESKTOP_STORE_FAMILY = 'Claude_pzs8sxrjxfjjc' // conferido com Get-AppxPackage / Get-StartApps
export const DESKTOP_STORE_AUMID = `${DESKTOP_STORE_FAMILY}!Claude`

/** Como abrir o Claude Desktop (argumentos fixos, nada vindo do usuário). null = não instalado. */
export function desktopLaunch(localAppData: string, exists: (p: string) => boolean): { file: string; args: string[] } | null {
  const legacy = path.join(localAppData, 'AnthropicClaude', 'claude.exe')
  if (exists(legacy)) return { file: legacy, args: [] }
  if (exists(path.join(localAppData, 'Packages', DESKTOP_STORE_FAMILY))) return { file: 'explorer.exe', args: ['shell:AppsFolder\\' + DESKTOP_STORE_AUMID] }
  return null
}
