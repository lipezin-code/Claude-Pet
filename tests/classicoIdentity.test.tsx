import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { loadSkins } from '../src/main/skins'
import { PetSprite } from '../src/renderer/Pet'
import type { Skin } from '../src/shared/skins'
import { caseLabel, SPRITE_CASES, type SpriteCase } from './spriteCases'

// Fixture: hash do SVG de cada combinação. Mesmo markup + mesmo CSS => mesmos pixels. Clássico = 'crab'; Azul (ex-Gotinha) = 'blob'.
// Gravada antes do sistema de skins (4faad46); regravada SÓ p/ a pose de lado com notebook (sem notebook: conferido idêntico).
// Regerar de propósito, quando o visual mudar: GEN_FIXTURE=1 npx vitest run tests/classicoIdentity
const FIXTURE = path.join(__dirname, 'fixtures', 'sprite-baseline.json')
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)
const render = (c: SpriteCase, skin: Skin) => renderToStaticMarkup(<PetSprite skin={skin} {...c} glyphN={1} />)
const skins = loadSkins(path.join(__dirname, '..', 'skins'), () => {})

describe('mascote atual preservado pixel a pixel', () => {
  if (process.env.GEN_FIXTURE) {
    it('grava fixture', () => {
      const out = { crab: SPRITE_CASES.map((c) => hash(render(c, skins.get('classico')!))), blob: SPRITE_CASES.map((c) => hash(render(c, skins.get('azul')!))) }
      fs.writeFileSync(FIXTURE, JSON.stringify(out))
    }, 300_000)
    return
  }
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { crab: string[]; blob: string[] }
  const cases: [string, Skin | undefined, string[]][] = [
    ['Clássico (skins/classico)', skins.get('classico'), fx.crab], // = CLASSICO embutido (tests/skinsRender)
    ['Azul = antiga Gotinha', skins.get('azul'), fx.blob]
  ]
  for (const [name, skin, expected] of cases) {
    it(`${name}: ${SPRITE_CASES.length} combinações idênticas`, () => {
      expect(skin).toBeDefined()
      expect(expected.length).toBe(SPRITE_CASES.length)
      const bad = SPRITE_CASES.filter((c, i) => hash(render(c, skin!)) !== expected[i]).map(caseLabel)
      expect(bad.slice(0, 10)).toEqual([])
    }, 300_000) // pesado: ~20-90 s com a suíte inteira em paralelo
  }
})
