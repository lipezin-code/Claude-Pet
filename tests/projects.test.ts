import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECENT, OpenRef, Projects, canonical, idOf, sensitivity, type Roots } from '../src/main/projects'

let base: string, roots: Roots, file: string
const mk = (...p: string[]) => { const d = path.join(base, ...p); fs.mkdirSync(d, { recursive: true }); return canonical(d)! }

beforeEach(() => {
  base = canonical(fs.mkdtempSync(path.join(os.tmpdir(), 'pj-')))!
  const home = mk('home')
  roots = { home, claude: mk('home', '.claude'), appData: [mk('home', 'AppData')], temp: mk('tmpzone') }
  file = path.join(base, 'projects.json')
})

describe('canonical', () => {
  it('une maiúsculas/minúsculas, barra e espaço final no mesmo caminho', () => {
    const p = mk('Projetos', 'app')
    for (const v of [path.join(base, 'PROJETOS', 'app'), p + '\\', p + '/', ` ${p} `]) expect(canonical(v)).toBe(p)
    expect(idOf(canonical(path.join(base, 'PROJETOS', 'APP'))!)).toBe(idOf(p))
  })
  it('aceita espaços e acentos', () => {
    const p = mk('Meus Projetos', 'Ação Teste')
    expect(canonical(p)).toBe(p)
    expect(path.basename(p)).toBe('Ação Teste')
  })
  it('recusa inexistente, arquivo e lixo', () => {
    fs.writeFileSync(path.join(base, 'f.txt'), 'x')
    expect(canonical(path.join(base, 'nao-existe'))).toBeNull()
    expect(canonical(path.join(base, 'f.txt'))).toBeNull()
    for (const v of ['', '   ', 42, null, 'x'.repeat(2000)]) expect(canonical(v)).toBeNull()
  })
})

describe('sensitivity', () => {
  it('detecta home, raiz, .claude, AppData, Temp e UNC', () => {
    expect(sensitivity(roots.home, roots)).toBe('home')
    expect(sensitivity(roots.home.toUpperCase(), roots)).toBe('home')
    expect(sensitivity('C:\\', roots)).toBe('root')
    expect(sensitivity(path.join(roots.claude, 'projects', 'x', 'memory'), roots)).toBe('claude')
    expect(sensitivity(path.join(roots.appData[0], 'Roaming'), roots)).toBe('appdata')
    expect(sensitivity(path.join(roots.temp, 'scratchpad'), roots)).toBe('temp')
    expect(sensitivity('\\\\servidor\\share\\proj', roots)).toBe('unc')
  })
  it('subpasta comum da home não é sensível; prefixo parecido também não', () => {
    expect(sensitivity(path.join(roots.home, 'Documents', 'app'), roots)).toBeNull()
    expect(sensitivity(roots.claude + '-backup', roots)).toBeNull()
  })
})

describe('Projects', () => {
  it(`recentes: mais novo primeiro, sem duplicata, máx. ${MAX_RECENT}`, () => {
    const pj = new Projects(file, roots)
    const dirs = Array.from({ length: 7 }, (_, i) => mk('p', `d${i}`))
    dirs.forEach((d) => pj.add(d, true))
    pj.add(dirs[3], true)
    const l = pj.list('manual', true)
    expect(l.map((x) => x.path)).toEqual([dirs[3], dirs[6], dirs[5], dirs[4], dirs[2]])
    expect(l.every((x) => x.group === 'recent')).toBe(true)
  })
  it('pasta sensível confirmada fica só nesta execução e não pode ser fixada', () => {
    const pj = new Projects(file, roots)
    const id = pj.add(roots.home, true)
    expect(pj.list('manual', true)).toEqual([expect.objectContaining({ id, group: 'session' })])
    expect(() => pj.pin(id, true)).toThrow()
    expect(new Projects(file, roots).list('manual', true)).toEqual([]) // não persistiu
  })
  it('fixar, desafixar, remover, limpar recentes', () => {
    const pj = new Projects(file, roots)
    const a = mk('a'), b = mk('b')
    const ia = pj.add(a, true); pj.add(b, true)
    pj.pin(ia, true)
    expect(pj.list('manual', true).map((x) => [x.path, x.group])).toEqual([[a, 'pinned'], [b, 'recent']])
    pj.add(a, true) // já fixado: não volta para recentes
    expect(pj.list('manual', true).filter((x) => x.path === a)).toHaveLength(1)
    pj.clearRecent()
    expect(pj.list('manual', true).map((x) => x.path)).toEqual([a])
    pj.pin(ia, false)
    expect(pj.list('manual', true)).toEqual([expect.objectContaining({ path: a, group: 'recent' })])
    pj.remove(ia)
    expect(pj.list('manual', true)).toEqual([])
  })
  it('recentes desligados: não grava, mas a pasta vale nesta execução', () => {
    const pj = new Projects(file, roots)
    const a = mk('a')
    pj.add(a, false)
    expect(pj.list('manual', false)).toEqual([expect.objectContaining({ path: a, group: 'session' })])
    expect(new Projects(file, roots).list('manual', true)).toEqual([])
  })
  it('resolve só aceita id conhecido, nunca caminho', () => {
    const pj = new Projects(file, roots)
    const a = mk('a'); const id = pj.add(a, true)
    expect(pj.resolve(id, 'manual', true)).toBe(a)
    for (const bad of [a, 'C:\\Windows', idOf(mk('outra')), 'zzzzzzzzzzzz', '', null, { id }]) expect(pj.resolve(bad, 'manual', true)).toBeNull()
  })
  it('automática: canoniza, une duplicatas e ignora sensíveis e internos', () => {
    const pj = new Projects(file, roots)
    const a = mk('Projetos', 'app')
    const cands = [path.join(base, 'PROJETOS', 'app'), a, roots.home, path.join(roots.claude, 'projects', 'x'), path.join(roots.temp), path.join(base, 'sumiu')]
    mk('home', '.claude', 'projects', 'x')
    expect(pj.list('auto', true, cands).map((x) => [x.path, x.group])).toEqual([[a, 'auto']])
    expect(pj.list('manual', true, cands)).toEqual([]) // manual ignora candidatos
  })
  it('migração: lista antiga vira recentes filtrados, nada fixado', () => {
    const pj = new Projects(file, roots)
    expect(pj.exists()).toBe(false)
    const a = mk('Projetos', 'a'), b = mk('b')
    const old = [path.join(base, 'PROJETOS', 'a'), a, roots.home, '', path.join(base, 'nao-existe'), b, ...Array.from({ length: 6 }, (_, i) => mk('m', `${i}`))]
    const r = pj.migrate(old)
    expect(r).toHaveLength(MAX_RECENT)
    expect(r.slice(0, 2)).toEqual([a, b])
    expect(pj.exists()).toBe(true)
    expect(pj.list('manual', true).every((x) => x.group === 'recent')).toBe(true)
  })
})

describe('OpenRef (IPC)', () => {
  it('aceita só referências por id', () => {
    expect(OpenRef.safeParse(undefined).success).toBe(true)
    expect(OpenRef.safeParse({ project: 'a1b2c3d4e5f6' }).success).toBe(true)
    expect(OpenRef.safeParse({ conv: '6f1c2b0e-8d3a-4c3b-9a55-1f0a6c1d2e3f', resume: true }).success).toBe(true)
    expect(OpenRef.safeParse({ session: 'baa9b219-aaaa' }).success).toBe(true)
  })
  it('recusa caminhos e campos extras', () => {
    for (const bad of ['C:\\', { cwd: 'C:\\' }, { project: 'C:\\Users' }, { project: 'a1b2c3d4e5f6', cwd: 'C:\\' }, { session: 'x;calc' }, { conv: 'nao-uuid' }])
      expect(OpenRef.safeParse(bad).success).toBe(false)
  })
})
