import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installedEvents, mergeHooks, removeHooks } from '../shared/hooksConfig'
import { lineDiff } from '../shared/lineDiff'
import { bridgeCommand, chainOf, installStatusLine, isOurStatusLine, restoreStatusLine } from '../shared/statuslineConfig'
import type { BridgeState, HooksStatus } from '../shared/types'

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
export const settingsPath = () => path.join(claudeDir(), 'settings.json')

const stripBom = (raw: string) => (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)

/** Conteúdo bruto do settings.json; null = arquivo não existe. */
function readRaw(): string | null {
  try { return fs.readFileSync(settingsPath(), 'utf8') } catch (e: any) {
    if (e?.code === 'ENOENT') return null
    throw new Error('settings.json existe mas não é JSON válido; nada foi alterado')
  }
}

function parseSettings(raw: string | null): Record<string, any> {
  if (raw === null) return {}
  try { return JSON.parse(stripBom(raw)) } catch { throw new Error('settings.json existe mas não é JSON válido; nada foi alterado') }
}

// replace(BOM): tolera arquivos salvos pelo Notepad/PowerShell
function readSettings(): Record<string, any> {
  return parseSettings(readRaw())
}

/** Cópia datada em ~/.claude/backups. Retorna o caminho (null se o settings.json não existia). */
function backup(): string | null {
  const p = settingsPath()
  if (!fs.existsSync(p)) return null
  const dir = path.join(claudeDir(), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const dst = path.join(dir, `settings.claude-pet.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.copyFileSync(p, dst)
  return dst
}

/** Escrita atômica (tmp + rename), revalidando o JSON do tmp antes de trocar. Retorna o texto gravado. */
function write(obj: Record<string, any>): string {
  const p = settingsPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const text = JSON.stringify(obj, null, 2)
  fs.writeFileSync(p + '.tmp', text, 'utf8')
  JSON.parse(fs.readFileSync(p + '.tmp', 'utf8'))
  fs.renameSync(p + '.tmp', p)
  return text
}

export function findNode(): string {
  try {
    const out = execFileSync('where.exe', ['node'], { windowsHide: true, timeout: 5000 }).toString()
    return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? 'node'
  } catch { return 'node' }
}

const hookDst = (dataDir: string) => path.join(dataDir, 'hook', 'claude-pet-hook.cjs')
const fingerprint = (raw: string | null) => createHash('sha256').update(raw ?? '(settings.json ausente)').digest('hex')

/**
 * Prévia SEM gravar: diferença entre o settings.json atual e o resultado do merge (só os hooks do pet entram/mudam;
 * os de terceiros ficam). `token` = impressão do arquivo lido; a gravação só acontece com ele (ver installHooks).
 */
export function previewHooks(dataDir: string): { diff: string; changes: number; token: string; settingsPath: string; exists: boolean } {
  const raw = readRaw()
  const cur = parseSettings(raw)
  const d = lineDiff(JSON.stringify(cur, null, 2), JSON.stringify(mergeHooks(cur, findNode(), hookDst(dataDir)), null, 2))
  return { diff: d.text, changes: d.changes, token: fingerprint(raw), settingsPath: settingsPath(), exists: raw !== null }
}

/**
 * Copia o hook para um caminho estável (fora do asar) e faz merge no settings.json com backup.
 * Com `token` (vindo da prévia que você confirmou): recusa se o settings.json mudou depois da prévia.
 * Sem token: só o instalador NSIS (--install-hooks).
 */
export function installHooks(dataDir: string, bundledHook: string, token?: string): HooksStatus {
  if (token !== undefined && fingerprint(readRaw()) !== token) throw new Error('settings.json mudou depois da prévia; nada foi gravado. Gere a prévia de novo.')
  const dst = hookDst(dataDir)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(bundledHook, dst)
  const current = readSettings()
  backup()
  write(mergeHooks(current, findNode(), dst))
  return hooksStatus()
}

/** Hook já instalado e o do app mudou (atualização): troca só o script na pasta de dados. Não toca no settings.json. */
export function refreshHookScript(dataDir: string, bundledHook: string): boolean {
  const dst = path.join(dataDir, 'hook', 'claude-pet-hook.cjs')
  try {
    if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') === fs.readFileSync(bundledHook, 'utf8')) return false
    fs.copyFileSync(bundledHook, dst)
    return true
  } catch { return false }
}

export function uninstallHooks(): HooksStatus {
  const cur = readSettings()
  if (installedEvents(cur).length === 0) return hooksStatus() // nada nosso: não toca no arquivo
  backup()
  write(removeHooks(cur))
  return hooksStatus()
}

export function hooksStatus(): HooksStatus {
  let events: string[] = []
  try { events = installedEvents(readSettings()) } catch { /* settings ilegível */ }
  return { installed: events.length > 0, events, settingsPath: settingsPath() }
}

// ---------- ponte da status line (faixa de uso) ----------
// O estado da instalação fica na config PRÓPRIA do pet (<dataDir>/statusline.json), nunca no settings.json:
// comando original (p/ encadear e restaurar), se o settings.json existia, backup da 1ª instalação e hash do que gravamos.
export interface BridgeCfg {
  chain: string | null
  minimal: boolean
  original: unknown
  hadFile: boolean
  backupFile: string | null
  installedHash: string
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const cfgPath = (dataDir: string) => path.join(dataDir, 'statusline.json')

export function readBridgeCfg(dataDir: string): BridgeCfg | null {
  try { const c = JSON.parse(fs.readFileSync(cfgPath(dataDir), 'utf8')); return c && typeof c.installedHash === 'string' ? c : null } catch { return null }
}
function writeBridgeCfg(dataDir: string, c: BridgeCfg) {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(cfgPath(dataDir) + '.tmp', JSON.stringify(c, null, 1), 'utf8')
  fs.renameSync(cfgPath(dataDir) + '.tmp', cfgPath(dataDir))
}

export function installStatusBridge(dataDir: string, bundledScript: string, minimal: boolean): BridgeState {
  const raw = readRaw()
  const cur = parseSettings(raw) // inválido: lança antes de qualquer escrita
  const dst = path.join(dataDir, 'hook', 'claude-pet-statusline.cjs')
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(bundledScript, dst)
  const prev = readBridgeCfg(dataDir)
  const reinstall = isOurStatusLine(cur.statusLine)
  // reinstalação: o original continua o da 1ª instalação; a restauração byte a byte só vale se nada mudou desde então
  const original = reinstall ? prev?.original ?? null : cur.statusLine ?? null
  const unchanged = reinstall && !!prev && raw !== null && sha(raw) === prev.installedHash
  const bk = backup()
  const text = write(installStatusLine(cur, bridgeCommand(findNode(), dst)))
  writeBridgeCfg(dataDir, {
    chain: chainOf(original), minimal, original,
    hadFile: reinstall ? prev?.hadFile ?? true : raw !== null,
    backupFile: reinstall ? (unchanged ? prev!.backupFile : null) : bk,
    installedHash: sha(text)
  })
  return bridgeStatus(dataDir)
}

export type RemoveResult = 'restored' | 'field' | 'conflict' | 'released' | 'nothing'

/**
 * Remove a ponte. Arquivo idêntico ao que gravamos => volta o backup byte a byte (ou some, se não existia).
 * Outras chaves mudaram => só o campo statusLine volta ao original. statusLine trocada por outra pessoa =>
 * não escreve nada ('conflict'); com force, só esquece a instalação no pet ('released').
 */
export function removeStatusBridge(dataDir: string, force = false): RemoveResult {
  const raw = readRaw()
  const cur = parseSettings(raw)
  const cfg = readBridgeCfg(dataDir)
  if (!isOurStatusLine(cur.statusLine)) {
    if (!cfg) return 'nothing'
    if (!force) return 'conflict'
    fs.rmSync(cfgPath(dataDir), { force: true })
    return 'released'
  }
  backup()
  let result: RemoveResult = 'field'
  if (cfg && raw !== null && sha(raw) === cfg.installedHash) {
    if (!cfg.hadFile) { fs.rmSync(settingsPath()); result = 'restored' }
    else if (cfg.backupFile && fs.existsSync(cfg.backupFile)) {
      fs.copyFileSync(cfg.backupFile, settingsPath() + '.tmp')
      fs.renameSync(settingsPath() + '.tmp', settingsPath())
      result = 'restored'
    }
  }
  if (result === 'field') write(restoreStatusLine(cur, cfg?.original))
  fs.rmSync(cfgPath(dataDir), { force: true })
  return result
}

export function bridgeStatus(dataDir: string): BridgeState {
  const cfg = readBridgeCfg(dataDir)
  let sl: unknown
  try { sl = readSettings().statusLine } catch { return 'unreadable' }
  if (isOurStatusLine(sl)) return cfg?.chain ? 'chained' : 'installed'
  return cfg ? 'conflict' : 'not_installed'
}

/** Liga/desliga o texto mínimo (só na config do pet; o settings.json não muda). */
export function setBridgeMinimal(dataDir: string, minimal: boolean) {
  const c = readBridgeCfg(dataDir)
  if (c && c.minimal !== minimal) writeBridgeCfg(dataDir, { ...c, minimal })
}

/** Arquivos que podem sobrescrever a statusLine do usuário (projeto/local/gerenciado). Só leitura. */
export function statusLineOverrides(cwds: string[]): string[] {
  const user = path.resolve(settingsPath()).toLowerCase()
  const files = [...new Set(cwds.filter(Boolean))].flatMap((c) => ['settings.json', 'settings.local.json'].map((f) => path.join(c, '.claude', f)))
  files.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json'))
  return files.filter((f) => {
    if (path.resolve(f).toLowerCase() === user) return false
    try { return !!JSON.parse(stripBom(fs.readFileSync(f, 'utf8'))).statusLine } catch { return false }
  })
}
