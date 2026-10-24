import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findTranscript, isInside, MAX_LINE, TranscriptReader, TranscriptTail } from '../src/main/usage'

// Fixtures SINTÉTICAS: só a forma das linhas (sem conteúdo real de conversa).
const asst = (id: string, read: number, creation: number, input: number, extra = '') =>
  JSON.stringify({ type: 'assistant', requestId: 'req_' + id, message: { id, role: 'assistant', content: [{ type: 'text', text: 'x' + extra }], usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: creation, output_tokens: 5 } } }) + '\n'
const user = () => JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }) + '\n'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-tr-')) })
const file = (name = 't.jsonl') => path.join(root, name)

describe('TranscriptTail', () => {
  it('conta cada resposta uma vez (mesma resposta em várias linhas)', async () => {
    fs.writeFileSync(file(), user() + asst('m1', 100, 10, 1) + asst('m1', 100, 10, 1) + asst('m1', 100, 10, 1) + asst('m2', 200, 0, 2))
    const t = new TranscriptTail(file())
    while (await t.readNew()) { /* */ }
    expect(t.totals).toEqual({ read: 300, creation: 10, input: 3 })
  })
  it('leitura incremental: só os bytes novos; linha partida entre leituras', async () => {
    const a = asst('m1', 100, 0, 0), b = asst('m2', 50, 0, 0)
    fs.writeFileSync(file(), a + b.slice(0, 20)) // linha b incompleta
    const t = new TranscriptTail(file())
    await t.readNew()
    expect(t.totals.read).toBe(100)
    fs.appendFileSync(file(), b.slice(20) + asst('m2', 50, 0, 0)) // b completa + duplicata
    await t.readNew()
    expect(t.totals.read).toBe(150)
    expect(t.offset).toBe(fs.statSync(file()).size)
  })
  it('respeita o limite por leitura (chunks pequenos dão o mesmo total)', async () => {
    let s = ''
    for (let i = 0; i < 200; i++) s += asst('m' + i, 10, 1, 1) + asst('m' + i, 10, 1, 1)
    fs.writeFileSync(file(), s)
    const t = new TranscriptTail(file())
    let reads = 0
    while (await t.readNew(997)) reads++
    expect(reads).toBeGreaterThan(10)
    expect(t.totals).toEqual({ read: 2000, creation: 200, input: 200 })
  })
  it('linha gigante é descartada sem afetar as vizinhas', async () => {
    fs.writeFileSync(file(), asst('m1', 1, 0, 0) + asst('big', 999, 0, 0, 'y'.repeat(MAX_LINE + 10)) + asst('m2', 2, 0, 0))
    const t = new TranscriptTail(file())
    while (await t.readNew()) { /* */ }
    expect(t.totals.read).toBe(3)
  })
  it('arquivo truncado/recriado recomeça do zero; JSON quebrado é ignorado', async () => {
    fs.writeFileSync(file(), asst('m1', 100, 0, 0) + asst('m2', 100, 0, 0))
    const t = new TranscriptTail(file())
    await t.readNew()
    fs.writeFileSync(file(), '{"usage": quebrado\n' + asst('m9', 7, 0, 0))
    await t.readNew()
    expect(t.totals.read).toBe(7)
  })
  it('ignora usage fora de type=assistant e valores não numéricos/negativos', async () => {
    fs.writeFileSync(file(), JSON.stringify({ type: 'user', message: { usage: { cache_read_input_tokens: 999 } } }) + '\n'
      + JSON.stringify({ type: 'assistant', message: { id: 'x', usage: { cache_read_input_tokens: '5', cache_creation_input_tokens: -3, input_tokens: 4 } } }) + '\n')
    const t = new TranscriptTail(file())
    await t.readNew()
    expect(t.totals).toEqual({ read: 0, creation: 0, input: 4 })
  })
})

describe('findTranscript (confinado a projects)', () => {
  let projects: string, outside: string
  const SID = '11111111-2222-3333-4444-555555555555'
  beforeEach(() => {
    projects = path.join(root, 'projects'); outside = path.join(root, 'fora')
    fs.mkdirSync(path.join(projects, 'C--proj'), { recursive: true }); fs.mkdirSync(outside)
  })
  it('acha <projects>/<pasta>/<sid>.jsonl', () => {
    fs.writeFileSync(path.join(projects, 'C--proj', SID + '.jsonl'), '')
    expect(findTranscript(projects, SID)).toBe(fs.realpathSync(path.join(projects, 'C--proj', SID + '.jsonl')))
  })
  it('id com ../ ou separadores é recusado', () => {
    fs.writeFileSync(path.join(root, 'x.jsonl'), '')
    expect(findTranscript(projects, '../x')).toBeNull()
    expect(findTranscript(projects, '..\\..\\x')).toBeNull()
    expect(findTranscript(projects, 'C--proj/' + SID)).toBeNull()
  })
  it('inexistente = null', () => expect(findTranscript(projects, SID)).toBeNull())
  it('symlink de arquivo apontando para fora é recusado', () => {
    fs.writeFileSync(path.join(outside, 'alvo.jsonl'), asst('m', 1, 0, 0))
    try { fs.symlinkSync(path.join(outside, 'alvo.jsonl'), path.join(projects, 'C--proj', SID + '.jsonl'), 'file') } catch { return } // sem privilégio p/ symlink: coberto pelo caso da junction
    expect(findTranscript(projects, SID)).toBeNull()
  })
  it('junction/pasta-link apontando para fora é recusada', () => {
    fs.writeFileSync(path.join(outside, SID + '.jsonl'), asst('m', 1, 0, 0))
    fs.symlinkSync(outside, path.join(projects, 'link'), 'junction')
    expect(findTranscript(projects, SID)).toBeNull()
  })
  it('isInside', () => {
    expect(isInside('C:\\a', 'C:\\a\\b\\c.jsonl')).toBe(true)
    expect(isInside('C:\\a', 'C:\\a')).toBe(false)
    expect(isInside('C:\\a', 'C:\\ab\\c')).toBe(false)
    expect(isInside('C:\\a', 'C:\\a\\..\\b')).toBe(false)
  })
  it('TranscriptReader entrega os totais da sessão', async () => {
    fs.writeFileSync(path.join(projects, 'C--proj', SID + '.jsonl'), asst('m1', 10, 2, 1) + asst('m1', 10, 2, 1))
    const got = await new Promise((resolve) => new TranscriptReader(projects, (_sid, t) => resolve(t)).update(SID))
    expect(got).toEqual({ read: 10, creation: 2, input: 1 })
  })
})
