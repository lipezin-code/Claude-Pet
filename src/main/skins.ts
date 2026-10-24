import fs from 'node:fs'
import path from 'node:path'
import { CLASSICO, DEFAULT_SKIN, MAX_MANIFEST_BYTES, MAX_SKINS, parseSkin, SKIN_ID, skinOrder, type Skin } from '../shared/skins'

/**
 * Registry: lê só subpastas diretas de `dir` cujo nome casa SKIN_ID (sem "..", barras ou caminhos absolutos)
 * e trata cada skin.json como não confiável. Skin inválida é ignorada com log; o Clássico embutido sempre existe.
 */
export function loadSkins(dir: string, log: (m: string) => void): Map<string, Skin> {
  const out = new Map<string, Skin>([[DEFAULT_SKIN, CLASSICO]])
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { log('skins: pasta ausente; usando só o Clássico embutido'); return out }
  for (const e of entries.sort((a, b) => skinOrder(a.name, b.name))) {
    if (!e.isDirectory()) continue // arquivos e links simbólicos ficam de fora
    if (!SKIN_ID.test(e.name)) { log('skins: pasta com nome inválido ignorada'); continue }
    if (out.size >= MAX_SKINS && !out.has(e.name)) { log(`skins: limite de ${MAX_SKINS} atingido; "${e.name}" ignorada`); continue }
    const file = path.join(dir, e.name, 'skin.json')
    let raw: string
    try {
      const st = fs.lstatSync(file)
      if (!st.isFile()) throw new Error('skin.json não é arquivo comum')
      if (st.size > MAX_MANIFEST_BYTES) throw new Error(`skin.json maior que ${MAX_MANIFEST_BYTES} bytes`)
      raw = fs.readFileSync(file, 'utf8')
    } catch (err) { log(`skins: "${e.name}" ignorada: ${(err as Error).message.split('\n')[0]}`); continue }
    const r = parseSkin(raw, e.name)
    if ('error' in r) log(`skins: "${e.name}" ignorada: ${r.error}`)
    else out.set(r.skin.id, r.skin)
  }
  return out
}

/** skinId salvo -> id existente. `mascot: 'blob'` (Gotinha, versão anterior) migra para "azul"; "arco-iris" (removida) para "vermelho". */
export function resolveSkinId(saved: { skinId?: unknown; mascot?: unknown }, skins: Map<string, Skin>, log: (m: string) => void): string {
  const id = saved.mascot === 'blob' && (saved.skinId === undefined || saved.skinId === DEFAULT_SKIN) ? 'azul' : saved.skinId === 'arco-iris' ? 'vermelho' : saved.skinId
  if (typeof id === 'string' && SKIN_ID.test(id) && skins.has(id)) return id
  if (id !== undefined) log('skins: skin salva inválida ou inexistente; voltando ao Clássico')
  return DEFAULT_SKIN
}
