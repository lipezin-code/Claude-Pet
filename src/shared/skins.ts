import { z } from 'zod'
import { BODY, PALETTES } from './sprites'

// Skin = paleta aplicada ao mesmo sprite SVG (a forma nunca muda). Manifesto em skins/<id>/skin.json.
// schemaVersion permite uma v2 (ex.: camadas de acessório) sem quebrar as skins v1.
export const SKIN_ID = /^[a-z0-9-]{1,32}$/
export const DEFAULT_SKIN = 'classico'
export const MAX_MANIFEST_BYTES = 8 * 1024
export const MAX_SKINS = 32
// ordem de exibição (galeria/menu); ids fora da lista vêm depois, em ordem alfabética
const ORDER = ['classico', 'azul', 'roxo', 'verde', 'rosa', 'dark', 'branco', 'dourado', 'vermelho']
export const skinOrder = (a: string, b: string) => {
  const i = (id: string) => { const n = ORDER.indexOf(id); return n < 0 ? ORDER.length : n }
  return i(a) - i(b) || a.localeCompare(b)
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const SkinManifest = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(SKIN_ID),
  name: z.string().min(1).max(24),
  palette: z.object({ body: hex, shade: hex, eye: hex, cheek: hex, accent: hex }).strict(),
  bodyRows: z.array(hex).length(BODY.length).optional(), // cor do corpo por linha da grade (degradê)
  flags: z.object({
    outline: z.boolean(), // contorno 1px semitransparente fora do corpo (visibilidade em qualquer fundo)
    eyeGlow: z.boolean(), // brilho leve nos olhos
    animatedColor: z.boolean() // ciclo de matiz no corpo (só com animações ligadas)
  }).strict()
}).strict()
export type SkinManifest = z.infer<typeof SkinManifest>
export type Skin = SkinManifest & { swatches: [string, string, string] }

// degradê: as bolinhas mostram topo, meio e base do corpo
export const toSkin = (m: SkinManifest): Skin => ({ ...m, swatches: m.bodyRows ? [m.bodyRows[2], m.bodyRows[8], m.bodyRows[12]] : [m.palette.body, m.palette.shade, m.palette.eye] })

/** Luminância relativa e contraste WCAG (mesma fórmula do gerador). */
export function luminance(hex: string): number {
  const ch = (i: number) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)
}
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
export const LOW_CONTRAST = 1.5 // abaixo disso o par aparece em negrito no relatório (só informativo)

/** Valida um manifesto não confiável. Nunca lança. */
export function parseSkin(raw: string, folder: string): { skin: Skin } | { error: string } {
  let json: unknown
  try { json = JSON.parse(raw) } catch { return { error: 'JSON inválido' } }
  const r = SkinManifest.safeParse(json)
  if (!r.success) return { error: r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ') }
  if (r.data.id !== folder) return { error: 'id diferente do nome da pasta' }
  return { skin: toSkin(r.data) }
}

/** Clássico embutido: fallback final se a pasta de skins faltar ou estiver corrompida. */
const C = PALETTES.crab
export const CLASSICO: Skin = toSkin({
  schemaVersion: 1, id: DEFAULT_SKIN, name: 'Clássico',
  palette: { body: C.O, shade: C.D, eye: C.K, cheek: C.P, accent: C.A },
  flags: { outline: false, eyeGlow: false, animatedColor: false }
})
