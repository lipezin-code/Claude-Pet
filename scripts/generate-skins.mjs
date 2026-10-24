// Gera skins/<id>/skin.json de forma determinística: node scripts/generate-skins.mjs
// Cada recolor parte só da cor base e reproduz, em OKLCH, a MESMA relação que o Clássico tem entre seus tons
// (luminosidade relativa, croma relativo e desvio de matiz de sombra/olho/bochecha em relação ao corpo).
// Mapeamento exato slot -> cor: nada de interpolação de pixels. Clássico e Azul (ex-Gotinha) são copiados literalmente.
import fs from 'node:fs'
import path from 'node:path'

const CLASSICO = { body: '#e8743b', shade: '#b5532a', eye: '#1d1410', cheek: '#f6a38b', accent: '#ffd166' } // = PALETTES.crab
const GOTINHA = { body: '#7c9cff', shade: '#5570c9', eye: '#10142a', cheek: '#ffb4d1', accent: '#ffd166' } // = PALETTES.blob
const OFF = { outline: false, eyeGlow: false, animatedColor: false }

const SKINS = [
  { id: 'classico', name: 'Clássico', palette: CLASSICO },
  { id: 'azul', name: 'Azul', palette: GOTINHA },
  { id: 'roxo', name: 'Roxo', base: '#b455f2' },
  { id: 'verde', name: 'Verde', base: '#52e08f' },
  { id: 'rosa', name: 'Rosa', base: '#ff6fb1' },
  // corpo quase neutro: bochecha derivada sumiria (mesma luminosidade); rosado explícito
  { id: 'dark', name: 'Dark', base: '#353b4a', eye: '#f4f7ff', cheek: '#a0687e', flags: { eyeGlow: true } }, // sem contorno (escolha do usuário)
  { id: 'branco', name: 'Branco', base: '#f4efe3', cheek: '#f2a8a0', flags: { outline: true } },
  { id: 'dourado', name: 'Dourado', base: '#f7c531' },
  { id: 'vermelho', name: 'Vermelho', base: '#e5484d' } // substituiu o Arco-Íris (quem o usava migra para cá)
]

// ---- sRGB <-> OKLab/OKLCH ----
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
function toOklch(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
}
function fromOklch({ L, C, h }) {
  const A = C * Math.cos(h), B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
  return '#' + rgb.map((c) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, '0')).join('')
}

// relação do Clássico (slot relativo ao corpo)
const ref = toOklch(CLASSICO.body)
const rel = (hex) => { const o = toOklch(hex); return { kL: o.L / ref.L, kC: o.C / ref.C, dh: o.h - ref.h } }
const REL = { shade: rel(CLASSICO.shade), eye: rel(CLASSICO.eye), cheek: rel(CLASSICO.cheek) }
// corpo quase neutro (Branco, Dark): matiz pouco definido, então o croma relativo não pode explodir
const derive = (base, r) => { const b = toOklch(base); return fromOklch({ L: Math.min(0.98, b.L * r.kL), C: Math.min(0.37, b.C * r.kC), h: b.h + r.dh }) }

function build(s) {
  if (s.palette) return { schemaVersion: 1, id: s.id, name: s.name, palette: s.palette, flags: OFF }
  const palette = {
    body: s.base,
    shade: derive(s.base, REL.shade),
    eye: s.eye ?? derive(s.base, REL.eye),
    cheek: s.cheek ?? derive(s.base, REL.cheek),
    accent: CLASSICO.accent // brilhos/engrenagem ficam acima do corpo, sobre o fundo: mesma cor em todas
  }
  const out = { schemaVersion: 1, id: s.id, name: s.name, palette }
  if (s.rows) {
    const r = s.rows.map((c) => (c.startsWith('shade:') ? derive(c.slice(6), REL.shade) : c))
    out.bodyRows = [r[0], r[0], ...r] // linhas 0-1 não têm pixels de corpo; repetidas só p/ o índice bater com a grade
  }
  out.flags = { ...OFF, ...s.flags }
  return out
}

// relatório de contraste (WCAG) corpo x elementos fixos: só informativo
const FIXED = { question: '#ffd166', bang: '#4ade80', laptopLid: '#c3c3c3' } // = LAP_LIGHT em Pet.tsx (teclado, ao lado do corpo)
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const LOW_CONTRAST = 1.5 // = LOW_CONTRAST em src/shared/skins.ts

const repo = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const root = path.join(repo, 'skins')
const report = ['# Contraste corpo x elementos (WCAG)', '', `Gerado por \`npm run gen:skins\`. **Negrito** = abaixo de ${LOW_CONTRAST}. Degradê: pior linha do corpo. Só informativo: "?", "!" e placa não têm contorno (escolha do usuário).`, '',
  '| skin | olhos | "?" | "!" concluído | teclado do notebook | placa permissão* |', '|---|---|---|---|---|---|']
for (const s of SKINS) {
  const m = build(s)
  fs.mkdirSync(path.join(root, s.id), { recursive: true })
  fs.writeFileSync(path.join(root, s.id, 'skin.json'), JSON.stringify(m, null, 2) + '\n')
  console.log(s.id.padEnd(10), JSON.stringify(m.palette))
  const bodies = m.bodyRows ? [...new Set(m.bodyRows.slice(2))] : [m.palette.body]
  const cell = (c) => { const v = Math.min(...bodies.map((b) => contrast(b, c))); return v < LOW_CONTRAST ? `**${v.toFixed(2)}**` : v.toFixed(2) }
  report.push(`| ${m.name} | ${cell(m.palette.eye)} | ${cell(FIXED.question)} | ${cell(FIXED.bang)} | ${cell(FIXED.laptopLid)} | ${cell('#fbbf24')} |`)
}
report.push('', '\\* A placa fica sobre o fundo (acima do corpo), não sobre ele; difere do "!" pela forma (placa âmbar com haste) e pela cor. O notebook fica à esquerda do corpo, encostado nele (só as mãos ficam sobre o teclado).')
fs.mkdirSync(path.join(repo, 'docs'), { recursive: true })
fs.writeFileSync(path.join(repo, 'docs', 'skins-contrast.md'), report.join('\n') + '\n')
