import { execFile } from 'node:child_process'
import { cleanEnv } from './claudeCli'

// git SOMENTE LEITURA para a equipe manual. Regras: argumentos separados (sem shell), pasta por -C,
// sem locks opcionais (git log/rev-parse não escrevem no índice), fsmonitor desligado (não roda programa
// configurado no repositório), sem prompt de credencial, tempo limite e saída limitada.
// Nunca usar aqui nada que altere o repositório (merge, reset, checkout, worktree add, commit...).
const ENV = () => ({ ...cleanEnv(), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })

export function gitRead(cwd: string, args: string[], timeout = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args],
      { timeout, windowsHide: true, maxBuffer: 1024 * 1024, env: ENV() },
      (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

/** Nome de branch seguro para aparecer em comando/texto copiado (não começa com "-", sem "..", sem espaço). */
export const SAFE_BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,100}$/

/** Branch atual da pasta (null = não é repositório, HEAD destacado ou nome fora do padrão seguro). */
export async function currentBranch(cwd: string): Promise<string | null> {
  const out = (await gitRead(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim()
  return out && out !== 'HEAD' && SAFE_BRANCH.test(out) ? out : null
}

const SEP = String.fromCharCode(31) // separador de campos no --format (%x1f)

/**
 * Entrega mais recente de uma branch: 1º commit (do mais novo) cujo ASSUNTO começa com "ENTREGA:".
 * Só olha commits da branch que ainda não estão na base (base..branch). Nomes já validados por quem chama.
 */
export async function latestDelivery(cwd: string, base: string, slug: string): Promise<{ hash: string; at: number; subject: string; stat: string } | null> {
  if (!SAFE_BRANCH.test(base) || !SAFE_BRANCH.test(slug)) return null
  const ref = `refs/heads/${slug}`
  if ((await gitRead(cwd, ['rev-parse', '--verify', '--quiet', ref])) === null) return null
  const out = await gitRead(cwd, ['log', `refs/heads/${base}..${ref}`, '-n', '200', `--format=%H${'%x1f'}%ct${'%x1f'}%s`])
  for (const line of (out ?? '').split(/\r?\n/)) {
    const [hash, ct, subject = ''] = line.split(SEP)
    if (!/^[0-9a-f]{40}$/.test(hash ?? '') || !subject.startsWith('ENTREGA:')) continue
    const stat = (await gitRead(cwd, ['diff', '--shortstat', `refs/heads/${base}...${hash}`]))?.trim() ?? ''
    return { hash, at: Number(ct) * 1000, subject: subject.slice(0, 120), stat: stat.slice(0, 120) }
  }
  return null
}

/** a é ancestral de b? (git merge-base --is-ancestor; sai 0 = sim, 1 = não). Refs/hashes validados por quem chama. */
export async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  return (await gitRead(cwd, ['merge-base', '--is-ancestor', a, b])) !== null
}
