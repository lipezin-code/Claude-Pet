import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadSkins, resolveSkinId } from '../src/main/skins'
import { CLASSICO, MAX_MANIFEST_BYTES, MAX_SKINS, parseSkin } from '../src/shared/skins'

const valid = () => ({
  schemaVersion: 1, id: 'teste', name: 'Teste',
  palette: { body: '#112233', shade: '#0a1520', eye: '#ffffff', cheek: '#ff99aa', accent: '#ffd166' },
  flags: { outline: false, eyeGlow: false, animatedColor: false }
})
const parse = (m: unknown, folder = 'teste') => parseSkin(JSON.stringify(m), folder)
const rejects = (m: unknown, folder?: string) => expect('error' in parse(m, folder)).toBe(true)

describe('validador de manifesto', () => {
  it('aceita manifesto válido e deriva swatches', () => {
    const r = parse(valid())
    expect('skin' in r && r.skin.swatches).toEqual(['#112233', '#0a1520', '#ffffff'])
  })
  it('degradê: swatches vêm de topo/meio/base do corpo', () => {
    const r = parse({ ...valid(), bodyRows: Array.from({ length: 13 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`) })
    expect('skin' in r && r.skin.swatches).toEqual(['#000002', '#000008', '#00000c'])
  })
  it('rejeita JSON inválido', () => expect('error' in parseSkin('{ id: ', 'teste')).toBe(true))
  it('rejeita campos faltando', () => {
    for (const k of ['schemaVersion', 'id', 'name', 'palette', 'flags'] as const) { const m: any = valid(); delete m[k]; rejects(m) }
    const m: any = valid(); delete m.palette.eye; rejects(m)
    const f: any = valid(); delete f.flags.outline; rejects(f)
  })
  it('rejeita tipos errados', () => {
    rejects({ ...valid(), name: 42 })
    rejects({ ...valid(), schemaVersion: '1' })
    rejects({ ...valid(), flags: { ...valid().flags, outline: 'sim' } })
    rejects({ ...valid(), palette: { ...valid().palette, body: 'red' } })
    rejects({ ...valid(), palette: { ...valid().palette, body: '#12345' } })
    rejects({ ...valid(), bodyRows: ['#000000'] }) // comprimento != linhas da grade
    rejects({ ...valid(), name: '' })
    rejects({ ...valid(), name: 'x'.repeat(25) })
  })
  it('rejeita schemaVersion desconhecida', () => rejects({ ...valid(), schemaVersion: 2 }))
  it('rejeita id inválido ou diferente da pasta', () => {
    for (const id of ['Azul', 'azul!', '../azul', 'a/b', 'a\\b', 'C:', '', 'x'.repeat(33)]) rejects({ ...valid(), id }, id)
    rejects(valid(), 'outra-pasta')
  })
  it('rejeita campos extras, inclusive caminhos (../, absolutos)', () => {
    rejects({ ...valid(), frames: ['../../segredo.png'] })
    rejects({ ...valid(), sprite: 'C:\\Windows\\win.ini' })
    rejects({ ...valid(), sprite: '/etc/passwd' })
    rejects({ ...valid(), palette: { ...valid().palette, file: '../x' } })
    rejects({ ...valid(), flags: { ...valid().flags, extra: true } })
  })
})

describe('registry de skins', () => {
  const tmp: string[] = []
  afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })
  const mkdir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-skins-')); tmp.push(d); return d }
  const put = (dir: string, folder: string, content: string) => { fs.mkdirSync(path.join(dir, folder), { recursive: true }); fs.writeFileSync(path.join(dir, folder, 'skin.json'), content) }

  it('carrega válidas e ignora inválidas com log, sem lançar', () => {
    const dir = mkdir(), logs: string[] = []
    put(dir, 'teste', JSON.stringify(valid()))
    put(dir, 'quebrada', '{ nada')
    put(dir, 'trocada', JSON.stringify(valid())) // id "teste" != pasta
    put(dir, 'Nome_Ruim', JSON.stringify({ ...valid(), id: 'Nome_Ruim' }))
    put(dir, 'gigante', JSON.stringify({ ...valid(), id: 'gigante' }) + ' '.repeat(MAX_MANIFEST_BYTES))
    fs.mkdirSync(path.join(dir, 'pasta', 'skin.json'), { recursive: true }) // skin.json que é diretório
    fs.writeFileSync(path.join(dir, 'solto.json'), JSON.stringify(valid())) // arquivo fora de pasta
    const m = loadSkins(dir, (l) => logs.push(l))
    expect([...m.keys()]).toEqual(['classico', 'teste'])
    expect(logs.length).toBe(5)
    expect(logs.join('\n')).not.toMatch(/[A-Z]:\\|\/tmp\//i) // log não vaza caminhos do disco
  })
  it('pasta ausente: só o Clássico embutido', () => {
    const logs: string[] = []
    const m = loadSkins(path.join(os.tmpdir(), 'nao-existe-' + Date.now()), (l) => logs.push(l))
    expect([...m.values()]).toEqual([CLASSICO])
    expect(logs.length).toBe(1)
  })
  it(`limite de ${MAX_SKINS} skins`, () => {
    const dir = mkdir(), logs: string[] = []
    for (let i = 0; i < MAX_SKINS + 3; i++) put(dir, `s${String(i).padStart(2, '0')}`, JSON.stringify({ ...valid(), id: `s${String(i).padStart(2, '0')}` }))
    expect(loadSkins(dir, (l) => logs.push(l)).size).toBe(MAX_SKINS)
    expect(logs.filter((l) => l.includes('limite')).length).toBe(4)
  })
  it('Clássico corrompido no disco: o embutido continua', () => {
    const dir = mkdir()
    put(dir, 'classico', '{}')
    expect(loadSkins(dir, () => {}).get('classico')).toBe(CLASSICO)
  })
})

describe('skinId salvo', () => {
  const skins = new Map([['classico', CLASSICO], ['azul', { ...CLASSICO, id: 'azul' }]])
  const r = (saved: object) => { const logs: string[] = []; return { id: resolveSkinId(saved, skins, (l) => logs.push(l)), logs } }
  it('válido é mantido', () => expect(r({ skinId: 'azul', mascot: 'blob' }).id).toBe('azul'))
  it('inválido volta ao Clássico com log (sem o valor)', () => {
    for (const skinId of ['../../x', 'Azul', 42, null, 'nao-existe', 'x'.repeat(40)]) {
      const o = r({ skinId, mascot: 'crab' })
      expect(o.id).toBe('classico')
      expect(o.logs.length).toBe(1)
      expect(o.logs[0]).not.toContain(String(skinId))
    }
  })
  it('Gotinha (mascot blob, versão anterior) migra para Azul', () => {
    expect(r({ skinId: 'classico', mascot: 'blob' }).id).toBe('azul')
    expect(r({ mascot: 'blob' }).id).toBe('azul')
  })
  it('Arco-Íris (removida) migra para Vermelho', () => {
    const o = resolveSkinId({ skinId: 'arco-iris', mascot: 'crab' }, new Map([...skins, ['vermelho', { ...CLASSICO, id: 'vermelho' }]]), () => {})
    expect(o).toBe('vermelho')
  })
  it('padrão: Clássico sem log', () => expect(r({ skinId: 'classico', mascot: 'crab' })).toEqual({ id: 'classico', logs: [] }))
})
