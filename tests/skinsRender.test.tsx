import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadSkins } from '../src/main/skins'
import { GLYPH_COLOR, PERMISSION, PetSprite } from '../src/renderer/Pet'
import { CLASSICO, contrast, type Skin } from '../src/shared/skins'
import { BODY, BODY_SIDE, LAPTOP_PAD } from '../src/shared/sprites'
import { caseLabel, SPRITE_CASES, type SpriteCase } from './spriteCases'

const logs: string[] = []
const skins = loadSkins(path.join(__dirname, '..', 'skins'), (l) => logs.push(l))
const all = [...skins.values()]
const OFF = { outline: false, eyeGlow: false, animatedColor: false }
const render = (c: SpriteCase, skin: Skin) => renderToStaticMarkup(<PetSprite skin={skin} {...c} glyphN={1} />)
const geometry = (html: string) => html.replace(/ fill="#[0-9a-fA-F]{6}"/g, '') // só forma/posição/classes
// metade das combinações (animate=false) cobre todas as poses; animate só troca classes CSS
const CASES = SPRITE_CASES.filter((c) => !c.animate)

describe('skins empacotadas', () => {
  it('todas válidas (nenhuma ignorada pelo registry)', () => {
    expect(logs).toEqual([])
    expect(all.map((s) => s.id)).toEqual(['classico', 'azul', 'roxo', 'verde', 'rosa', 'dark', 'branco', 'dourado', 'vermelho'])
  })
  it('skins/classico/skin.json = Clássico embutido', () => expect(skins.get('classico')).toEqual(CLASSICO))
})

describe('forma: toda skin desenha exatamente os mesmos pixels do Clássico em todas as poses', () => {
  let ref: string[] | null = null // geometria do Clássico, calculada uma vez
  for (const s of all.filter((k) => k.id !== 'classico')) {
    it(`${s.id}: ${CASES.length} poses, só as cores mudam`, () => {
      ref ??= CASES.map((c) => geometry(render(c, CLASSICO)))
      const plain = { ...s, flags: OFF } // camadas das flags são testadas à parte
      const bad = CASES.filter((c, i) => geometry(render(c, plain)) !== ref![i]).map(caseLabel)
      expect(bad.slice(0, 5)).toEqual([])
    }, 300_000) // pesado: ~10-50 s com a suíte inteira em paralelo
  }
  it('contorno (flag outline) fica só FORA da máscara do corpo', () => {
    const opaque = new Set(BODY.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [`${x},${y}`]))))
    for (const s of all.filter((k) => k.flags.outline)) {
      const html = render(SPRITE_CASES[0], s)
      const ring = [...html.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="1" height="1" fill="#[0-9a-f]{6}" opacity="\.35"/g)].map((m) => `${m[1]},${m[2]}`)
      expect(ring.length).toBeGreaterThan(30)
      expect(ring.filter((p) => opaque.has(p))).toEqual([])
    }
  })
})

describe('pose de lado com notebook', () => {
  it('tudo dentro da janela (quadro de 16 colunas + faixa do notebook à esquerda), em todas as fases', () => {
    for (const laptop of ['taking', 'typing', 'held', 'stowing'] as const) {
      const xs = [...render({ ...SPRITE_CASES[0], laptop, state: 'WORKING', busyTool: true }, CLASSICO).matchAll(/<rect x="(-?[\d.]+)" y="[^"]+" width="([\d.]+)"/g)].map((m) => [+m[1], +m[1] + +m[2]])
      expect(xs.filter(([a, b]) => a < -LAPTOP_PAD || b > 16)).toEqual([])
      expect(Math.min(...xs.map(([a]) => a))).toBeLessThan(0) // o notebook usa a faixa à esquerda
    }
  })
  it('notebook não entra no corpo: nenhum pixel do notebook (exceto as mãos) sobre a máscara do corpo de lado', () => {
    const body = new Set(BODY_SIDE.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [`${x},${y}`]))))
    const lap = render({ ...SPRITE_CASES[0], laptop: 'typing', state: 'WORKING' }, CLASSICO).match(/<g class="laptop[^"]*">(.*)<\/g>/)![1]
    const noHands = lap.replace(/<g class="hand [^"]*">.*?<\/g>/g, '')
    const cells = [...noHands.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="1"/g)].flatMap((m) => Array.from({ length: +m[3] }, (_, i) => `${+m[1] + i},${m[2]}`))
    expect(cells.length).toBeGreaterThan(20)
    expect(cells.filter((c) => body.has(c))).toEqual([])
  })
})

describe('contraste corpo x elementos fixos', () => {
  const bodies = (s: Skin) => [...new Set(s.bodyRows ? s.bodyRows.slice(2) : [s.palette.body])]
  it('olhos legíveis em toda skin (>= 3:1 contra o corpo)', () => {
    for (const s of all) for (const b of bodies(s)) expect(contrast(b, s.palette.eye), s.id).toBeGreaterThanOrEqual(3)
  })
  it('"?", "!" e placa iguais em toda skin, sem contorno (relatório de contraste é só informativo)', () => {
    for (const s of all) for (const glyph of ['question', 'bang'] as const) {
      const g = render({ ...SPRITE_CASES[0], glyph }, s).match(/class="gbounce">(.*?)<\/g>/)![1]
      expect([...new Set([...g.matchAll(/fill="(#\w+)"/g)].map((m) => m[1]))], `${s.id} ${glyph}`).toEqual([GLYPH_COLOR[glyph]])
    }
  })
  it('permissão continua diferente do "?" e do "!" em toda skin (forma de placa âmbar x glifo solto)', () => {
    const sign = `width="5" height="5" fill="${PERMISSION}"`
    for (const s of all) {
      const perm = render({ ...SPRITE_CASES[0], state: 'WAITING_PERMISSION' }, s)
      const done = render({ ...SPRITE_CASES[0], state: 'COMPLETED', glyph: 'bang' }, s)
      const ask = render({ ...SPRITE_CASES[0], glyph: 'question' }, s)
      expect(perm).toContain(sign)
      for (const h of [done, ask]) expect(h).not.toContain(sign)
      expect(perm).not.toContain(GLYPH_COLOR.bang)
      expect(done).toContain(GLYPH_COLOR.bang)
      expect(ask).toContain(GLYPH_COLOR.question)
    }
  })
})
