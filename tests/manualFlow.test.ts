import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readEquipe } from '../src/main/manualProject'
import { adjustmentsPrompt, leaderInstruction, parseVerdict, taskPrompt, teamFlow } from '../src/shared/manualFlow'
import { buildRoster } from '../src/shared/teams'

const roster = () => { const r = buildRoster([{ kind: 'backend', label: 'Back-end' }, { kind: 'seguranca', label: 'Segurança' }]); if (!r.ok) throw new Error(); return r.agents }

describe('instrução do líder', () => {
  it('lista funções e slugs, usa a branch detectada e os caminhos de .equipe', () => {
    const t = leaderInstruction(roster(), 'develop')
    expect(t).toContain('Você é o LÍDER')
    expect(t).toContain('- Back-end · back-end')
    expect(t).toContain('- Segurança · seguranca')
    expect(t).toContain('.equipe/tarefas/<identificador>.md')
    expect(t).toContain('git diff develop..<identificador>')
    expect(t).toContain('"aprovado <hash>" ou "ajustes <hash>: <o que corrigir>"')
    expect(t).toContain('Merge na develop só depois que eu confirmar')
    expect(t).toContain('Segurança: por padrão só leem e escrevem relatório')
    expect(t).not.toContain('main')
  })
  it('tarefa copiada começa com a apresentação do agente', () => {
    expect(taskPrompt({ label: 'Back-end', slug: 'back-end' }, '  Fazer X  ')).toBe('Você é o agente de Back-end, na branch back-end. Siga o CLAUDE.md.\n\nFazer X')
  })
})

describe('leitura de .equipe (só leitura, presa na pasta)', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-eq-'))
  fs.mkdirSync(path.join(proj, '.equipe', 'tarefas'), { recursive: true })
  fs.writeFileSync(path.join(proj, '.equipe', 'tarefas', 'back-end.md'), '\uFEFFCriar rota')
  fs.writeFileSync(path.join(proj, 'segredo.md'), 'nao')
  it('lê a tarefa pelo slug (sem BOM)', () => expect(readEquipe(proj, 'tarefas', 'back-end')).toBe('Criar rota'))
  it('slug com caminho é recusado antes de tocar no disco', () => {
    expect(readEquipe(proj, 'tarefas', '../../segredo')).toBeNull()
    expect(readEquipe(proj, 'tarefas', '..')).toBeNull()
  })
  it('arquivo grande demais ou inexistente: null', () => {
    fs.writeFileSync(path.join(proj, '.equipe', 'tarefas', 'grande.md'), 'x'.repeat(40 * 1024))
    expect(readEquipe(proj, 'tarefas', 'grande')).toBeNull()
    expect(readEquipe(proj, 'revisoes', 'back-end')).toBeNull()
  })
  it('nada é escrito', () => {
    const before = fs.readdirSync(proj, { recursive: true }).map(String).sort().join('|')
    readEquipe(proj, 'tarefas', 'back-end')
    expect(fs.readdirSync(proj, { recursive: true }).map(String).sort().join('|')).toBe(before)
  })
})

describe('veredito do líder', () => {
  it('aprovado / ajustes com hash; ajustes levam o resto do arquivo', () => {
    expect(parseVerdict('aprovado ABCDEF1')).toEqual({ kind: 'approved', hash: 'abcdef1', notes: '' })
    expect(parseVerdict('# Revisão\n- ajustes abcdef1234: validar qtd\nresponder 400')).toEqual({ kind: 'changes', hash: 'abcdef1234', notes: 'validar qtd\nresponder 400' })
  })
  it('sem hash ou hash curto: não vale', () => {
    expect(parseVerdict('aprovado')).toBeNull()
    expect(parseVerdict('aprovado abc12')).toBeNull()
    expect(parseVerdict(null)).toBeNull()
  })
  it('texto de ajustes para o agente', () => {
    expect(adjustmentsPrompt({ label: 'Back-end', slug: 'back-end' }, { kind: 'changes', hash: 'abcdef1234567', notes: 'X' })).toContain('novo commit "ENTREGA:')
  })
})

describe('fluxo da equipe (teamFlow)', () => {
  const r = buildRoster([{ kind: 'backend', label: 'Back-end' }, { kind: 'testes', label: 'Testes' }])
  if (!r.ok) throw new Error()
  const ag = r.agents
  const H = 'a'.repeat(40), H2 = 'b'.repeat(40), T = 'c'.repeat(40)
  const idle = () => 'waiting' as const
  const d = (hash: string, merged = false, hasBase = true) => ({ hash, merged, hasBase })
  const flow = (del: Record<string, ReturnType<typeof d>>, ver: Record<string, any>, live = idle as (a: any) => any) => teamFlow(ag, live, del, ver)
  it('entregue -> aprovado só com o hash da ENTREGA mais recente', () => {
    expect(flow({ a1: d(H) }, {}).get('a1')).toBe('delivered')
    expect(flow({ a1: d(H) }, { a1: { kind: 'approved', hash: 'aaaaaaa', notes: '' } }).get('a1')).toBe('approved')
    expect(flow({ a1: d(H2) }, { a1: { kind: 'approved', hash: 'aaaaaaa', notes: '' } }).get('a1')).toBe('delivered') // entrega nova
    expect(flow({ a1: d(H) }, { a1: { kind: 'changes', hash: 'aaaaaaa', notes: 'x' } }).get('a1')).toBe('changes')
  })
  it('trabalhando vence o veredito', () => {
    expect(flow({ a1: d(H) }, { a1: { kind: 'changes', hash: 'aaaaaaa', notes: 'x' } }, () => 'working').get('a1')).toBe('working')
  })
  const ok = { kind: 'approved', hash: 'aaaaaaa', notes: '' }, okT = { kind: 'approved', hash: 'ccccccc', notes: '' }
  it('todos aprovados => líder "Pronto para integrar"', () => {
    expect(flow({ a1: d(H), a2: d(T) }, { a1: ok, a2: okT }).get('lider')).toBe('ready')
    expect(flow({ a1: d(H), a2: d(T) }, { a1: ok }).get('lider')).toBe('waiting')
  })
  it('integrado => Testes "Validando integração" até entregar já com a base', () => {
    const f = flow({ a1: d(H, true), a2: d(T, false, false) }, { a1: ok, a2: okT })
    expect(f.get('lider')).toBe('integrated')
    expect(f.get('a2')).toBe('validating')
    expect(flow({ a1: d(H, true), a2: d('d'.repeat(40), false, true) }, { a1: ok, a2: okT }).get('a2')).toBe('delivered')
  })
})
