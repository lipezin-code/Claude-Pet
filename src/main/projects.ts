import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { projectName } from '../shared/machine'
import type { ProjectItem } from '../shared/types'
import { JsonStore } from './store'

export const MAX_RECENT = 5
export const PROJECT_ID = /^[0-9a-f]{12}$/

/** Por que uma pasta é sensível: home/raiz/.claude/AppData/Temp nunca entram em Recentes nem na lista automática. */
export type Sensitive = 'home' | 'root' | 'claude' | 'appdata' | 'temp' | 'unc'
export interface Roots { home: string; claude: string; appData: string[]; temp: string }

const win = process.platform === 'win32'
export const keyOf = (p: string) => (win ? p.toLowerCase() : p)
export const idOf = (p: string) => createHash('sha1').update(keyOf(p)).digest('hex').slice(0, 12)

/** Caminho canônico (existe, é pasta, realpath, sem barra final) ou null. */
export function canonical(p: unknown): string | null {
  if (typeof p !== 'string' || !p.trim() || p.length > 1024) return null
  try {
    const r = fs.realpathSync.native(path.resolve(p.trim()))
    if (!fs.statSync(r).isDirectory()) return null
    return path.parse(r).root === r ? r : r.replace(/[\\/]+$/, '')
  } catch { return null }
}

const inside = (p: string, dir: string) => { const a = keyOf(p), b = keyOf(dir.replace(/[\\/]+$/, '')); return a === b || a.startsWith(b + path.sep) }

export function sensitivity(p: string, r: Roots): Sensitive | null {
  if (path.parse(p).root === p) return 'root'
  if (p.startsWith('\\\\')) return 'unc'
  if (inside(p, r.claude)) return 'claude'
  if (inside(p, r.temp)) return 'temp'
  if (r.appData.some((d) => d && inside(p, d))) return 'appdata'
  if (keyOf(p) === keyOf(r.home)) return 'home'
  return null
}
/** UNC é sensível só para confirmar; depois de confirmado pode ir para Recentes. */
export const blocksRecent = (s: Sensitive | null) => s !== null && s !== 'unc'

export const SENSITIVE_WHY: Record<Sensitive, string> = {
  home: 'É a sua pasta de usuário: o Claude Code teria acesso a Documentos, Downloads, .ssh e tudo mais.',
  root: 'É a raiz de um disco: o Claude Code teria acesso ao disco inteiro.',
  claude: 'É a pasta de configuração do Claude Code: uma sessão ali pode alterar settings.json e hooks.',
  appdata: 'É a pasta AppData: guarda dados e credenciais de vários programas.',
  temp: 'É uma pasta temporária: o conteúdo pode sumir e costuma ter restos de outras sessões.',
  unc: 'É uma pasta de rede: o conteúdo pode mudar fora do seu controle.'
}

/** Referências que o renderer pode mandar: só ids, nunca caminhos. */
export const OpenRef = z.union([
  z.object({ home: z.literal(true) }).strict(), // pasta do usuário (clique duplo no pet)
  z.object({ pick: z.literal(true) }).strict(), // sempre pergunta a pasta (botão laranja / modo equipe)
  z.object({ project: z.string().regex(PROJECT_ID) }).strict(),
  z.object({ conv: z.string().uuid(), resume: z.boolean().optional() }).strict(),
  z.object({ session: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) }).strict()
]).optional()
export type OpenRef = z.infer<typeof OpenRef>

interface Data { pinned: string[]; recent: string[] }

export class Projects {
  private store: JsonStore<Data>
  private transient = new Map<string, string>() // pastas sensíveis confirmadas: só nesta execução
  private canon = new Map<string, string | null>() // ponytail: cache sem expirar; pasta apagada some na próxima execução

  constructor(file: string, private roots: Roots) { this.store = new JsonStore<Data>(file, { pinned: [], recent: [] }) }

  exists() { return this.store.exists() }
  private data(): Data { const d = this.store.read(); return { pinned: d.pinned.filter(Boolean), recent: d.recent.filter(Boolean) } }
  private cached(p: string) { if (!this.canon.has(p)) this.canon.set(p, canonical(p)); return this.canon.get(p) ?? null }
  sensitivity(p: string) { return sensitivity(p, this.roots) }

  /** Lista para o seletor. Automática = pastas das sessões/conversas, canonizadas, sem sensíveis, sem duplicatas. */
  list(mode: 'manual' | 'auto', recentOn: boolean, autoCandidates: string[] = []): ProjectItem[] {
    const d = this.data()
    const out: ProjectItem[] = []
    const seen = new Set<string>()
    const push = (p: string, group: ProjectItem['group']) => {
      const k = keyOf(p); if (seen.has(k) || !fs.existsSync(p)) return
      seen.add(k); out.push({ id: idOf(p), path: p, name: projectName(p), group })
    }
    d.pinned.forEach((p) => push(p, 'pinned'))
    if (recentOn) d.recent.forEach((p) => push(p, 'recent'))
    this.transient.forEach((p) => push(p, 'session'))
    if (mode === 'auto') for (const c of autoCandidates) { const p = this.cached(c); if (p && !blocksRecent(this.sensitivity(p))) push(p, 'auto') }
    return out
  }

  resolve(id: unknown, mode: 'manual' | 'auto', recentOn: boolean, autoCandidates: string[] = []): string | null {
    if (typeof id !== 'string' || !PROJECT_ID.test(id)) return null
    return this.list(mode, recentOn, autoCandidates).find((x) => x.id === id)?.path ?? null
  }

  /** Registra uma pasta já canonizada e confirmada. Sensível fica só nesta execução. */
  add(p: string, recentOn: boolean): string {
    if (blocksRecent(this.sensitivity(p))) { this.transient.set(keyOf(p), p); return idOf(p) }
    const d = this.data()
    if (recentOn && !d.pinned.some((x) => keyOf(x) === keyOf(p))) d.recent = [p, ...d.recent.filter((x) => keyOf(x) !== keyOf(p))].slice(0, MAX_RECENT)
    else if (!recentOn && !d.pinned.some((x) => keyOf(x) === keyOf(p))) this.transient.set(keyOf(p), p)
    this.store.write(d)
    return idOf(p)
  }

  pin(id: string, on: boolean) {
    const d = this.data()
    const p = [...d.pinned, ...d.recent, ...this.transient.values()].find((x) => idOf(x) === id)
    if (!p) return
    if (on && blocksRecent(this.sensitivity(p))) throw new Error('Pastas sensíveis não podem ser fixadas')
    d.pinned = d.pinned.filter((x) => idOf(x) !== id)
    d.recent = d.recent.filter((x) => idOf(x) !== id)
    if (on) d.pinned.push(p); else d.recent = [p, ...d.recent].slice(0, MAX_RECENT)
    this.transient.delete(keyOf(p))
    this.store.write(d)
  }

  remove(id: string) {
    const d = this.data()
    for (const [k, p] of this.transient) if (idOf(p) === id) this.transient.delete(k)
    this.store.write({ pinned: d.pinned.filter((x) => idOf(x) !== id), recent: d.recent.filter((x) => idOf(x) !== id) })
  }

  clearRecent() { this.store.write({ ...this.data(), recent: [] }) }

  /** 1ª execução: lista antiga (padrão + conversas + sessões) vira Recentes filtrados. Nada é fixado. */
  migrate(oldPaths: string[]) {
    const recent: string[] = []
    for (const c of oldPaths) {
      const p = canonical(c)
      if (!p || blocksRecent(this.sensitivity(p)) || recent.some((x) => keyOf(x) === keyOf(p))) continue
      recent.push(p); if (recent.length >= MAX_RECENT) break
    }
    this.store.write({ pinned: [], recent })
    return recent
  }
}
