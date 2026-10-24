import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MascotController, type Input, type Visual } from '../src/renderer/mascot/controller'
import { T } from '../src/renderer/mascot/timings'
import type { PetState } from '../src/shared/types'

let ctl: MascotController
let cur: Visual
let log: Visual[]
const base: Input = { mode: 'IDLE', completionKey: null, animate: true, paused: false }

function make(rnd = () => 0) {
  ctl?.dispose(); ctlInput = null
  log = []
  cur = { state: 'IDLE', gaze: 0, laptop: 'none', glyph: 'none', glyphN: 0 }
  ctl = new MascotController((v) => { cur = v; log.push(v) }, T, rnd)
  return ctl
}
let ctlInput: Input | null = null
const feed = (p: Partial<Input>) => { ctlInput = { ...(ctlInput ?? base), ...p }; ctl.setInput(ctlInput) }
const adv = (ms: number) => vi.advanceTimersByTime(ms)

beforeEach(() => { vi.useFakeTimers(); ctlInput = null })
afterEach(() => { ctl?.dispose(); vi.useRealTimers() })

describe('IDLE', () => {
  it('troca o olhar em intervalos entre 1,5s e 4s', () => {
    make(() => 0) // rnd=0 => sempre o mínimo
    feed({})
    adv(T.gazeMinMs - 1); expect(cur.gaze).toBe(0)
    adv(1); expect(cur.gaze).not.toBe(0)
    make(() => 0.999); feed({})
    adv(T.gazeMinMs); expect(cur.gaze).toBe(0) // com rnd≈1 o intervalo é ~4s, não 1,5s
    adv(T.gazeMaxMs - T.gazeMinMs); expect(cur.gaze).not.toBe(0) // nunca passa de 4s
  })
  it('demo do notebook: digita 3s, mostra "?" 3s, guarda e volta', () => {
    make(() => 0); feed({})
    adv(T.demoMinMs - 1); expect(cur.laptop).toBe('none')
    adv(1); expect(cur.laptop).toBe('taking')
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('typing')
    adv(T.demoTypeMs - 1); expect(cur.laptop).toBe('typing'); expect(cur.glyph).toBe('none')
    adv(1); expect(cur.glyph).toBe('question'); expect(cur.laptop).toBe('held')
    adv(T.glyphMs); expect(cur.glyph).toBe('none'); expect(cur.laptop).toBe('stowing')
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('none')
  })
  it('nunca duas demos em menos de 45s', () => {
    make(() => 0); feed({})
    adv(T.demoMinMs)
    const startedAt = log.filter((v) => v.laptop === 'taking').length
    expect(startedAt).toBe(1)
    adv(T.laptopMoveMs + T.demoTypeMs + T.glyphMs + T.laptopMoveMs) // demo termina
    const afterEnd = log.filter((v) => v.laptop === 'taking').length
    adv(T.demoMinMs - 1); expect(log.filter((v) => v.laptop === 'taking').length).toBe(afterEnd)
    adv(1); expect(log.filter((v) => v.laptop === 'taking').length).toBe(afterEnd + 1)
  })
  it('estado de trabalho interrompe a demo na hora', () => {
    make(() => 0); feed({})
    adv(T.demoMinMs + T.laptopMoveMs + 500); expect(cur.laptop).toBe('typing')
    feed({ mode: 'THINKING' })
    expect(cur.glyph).toBe('none')
    adv(10_000); expect(cur.glyph).toBe('none'); expect(cur.laptop).toBe('typing')
  })
  it('dorme após 5 min e não anima mais', () => {
    make(() => 0.999); feed({})
    adv(T.sleepAfterMs); expect(cur.state).toBe('SLEEPING'); expect(cur.laptop).toBe('none')
    const n = log.length; adv(20 * 60_000); expect(log.length).toBe(n)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('hover/arraste (paused) cancela a demo e guarda o notebook', () => {
    make(() => 0); feed({})
    adv(T.demoMinMs + T.laptopMoveMs + 100); expect(cur.laptop).toBe('typing')
    feed({ paused: true })
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('none'); expect(cur.gaze).toBe(0)
    adv(10 * 60_000); expect(cur.laptop).toBe('none')
  })
})

describe('trabalho e conclusão', () => {
  it('THINKING/WORKING: digita continuamente, sem "?", mesmo entre ferramentas (PostToolUse)', () => {
    make(); feed({ mode: 'WORKING' })
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('typing')
    for (const m of ['THINKING', 'WORKING', 'THINKING', 'WORKING'] as PetState[]) { feed({ mode: m }); adv(500) }
    expect(log.every((v) => v.glyph === 'none')).toBe(true)
    expect(cur.laptop).toBe('typing')
  })
  it('Stop => "!" por 3s, depois visual volta ao calmo (IDLE) sem "?"', () => {
    make(); feed({ mode: 'WORKING' }); adv(1000)
    feed({ mode: 'COMPLETED', completionKey: 's1:100' })
    expect(cur.glyph).toBe('bang'); expect(cur.state).toBe('COMPLETED')
    adv(T.glyphMs - 1); expect(cur.glyph).toBe('bang')
    adv(1); expect(cur.glyph).toBe('none'); expect(cur.state).toBe('IDLE')
    expect(log.some((v) => v.glyph === 'question')).toBe(false)
  })
  it('conclusão que já existia ao abrir o app não dispara "!"; mesma chave não repete', () => {
    make(); feed({ mode: 'COMPLETED', completionKey: 'x:1' })
    expect(cur.glyph).toBe('none')
    make(); feed({ mode: 'WORKING' }); feed({ mode: 'COMPLETED', completionKey: 'a:1' })
    adv(T.glyphMs); feed({ completionKey: 'a:1' }); feed({ animate: true })
    expect(cur.glyph).toBe('none')
  })
  it('novo UserPromptSubmit durante o "!" cancela e vai a trabalhando; timer antigo não derruba', () => {
    make(); feed({ mode: 'WORKING' }); feed({ mode: 'COMPLETED', completionKey: 'a:1' })
    adv(1000); feed({ mode: 'THINKING', completionKey: null })
    expect(cur.glyph).toBe('none'); expect(cur.state).toBe('THINKING')
    adv(T.glyphMs * 3); expect(cur.state).toBe('THINKING'); expect(cur.glyph).toBe('none'); expect(cur.laptop).toBe('typing')
  })
  it('outra sessão ainda trabalhando (política mantém WORKING): sem "!"', () => {
    make(); feed({ mode: 'WORKING' }); adv(5000)
    expect(log.some((v) => v.glyph !== 'none')).toBe(false)
  })
  it('WAITING_PERMISSION nunca vira "?" nem "!" e cancela o decorativo', () => {
    make(() => 0); feed({}); adv(T.demoMinMs + T.laptopMoveMs + 100)
    feed({ mode: 'WAITING_PERMISSION' })
    expect(cur.state).toBe('WAITING_PERMISSION'); expect(cur.glyph).toBe('none')
    adv(10 * 60_000); expect(cur.glyph).toBe('none'); expect(cur.state).toBe('WAITING_PERMISSION'); expect(vi.getTimerCount()).toBeLessThanOrEqual(1) // só o stow do notebook, já concluído
  })
})

describe('reduzir movimento / animações desligadas', () => {
  it('sem olhares, sem demo, sem sono animado; trabalho vira indicador estático imediato', () => {
    make(() => 0); feed({ animate: false })
    adv(10 * 60_000)
    expect(cur.gaze).toBe(0); expect(cur.laptop).toBe('none'); expect(log.every((v) => v.glyph === 'none')).toBe(true)
    feed({ mode: 'WORKING' }); expect(cur.laptop).toBe('typing') // sem fase "pegando"
    feed({ mode: 'IDLE' }); expect(cur.laptop).toBe('none')
  })
  it('"!" de conclusão continua aparecendo (é informação, não enfeite)', () => {
    make(); feed({ animate: false, mode: 'WORKING' }); feed({ mode: 'COMPLETED', completionKey: 'a:1' })
    expect(cur.glyph).toBe('bang')
  })
})

describe('UNKNOWN', () => {
  it('alterna "?" (3s) e digitar (3s), sem "?" permanente', () => {
    make(() => 0); feed({ mode: 'UNKNOWN' })
    expect(cur.glyph).toBe('none')
    adv(T.unknownGapMinMs); expect(cur.glyph).toBe('question')
    adv(T.glyphMs); expect(cur.glyph).toBe('none')
    adv(T.unknownGapMinMs); expect(cur.laptop).toBe('taking')
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('typing')
    adv(T.unknownTypeMs); expect(cur.laptop).toBe('stowing')
    adv(T.laptopMoveMs); expect(cur.laptop).toBe('none')
    adv(T.unknownGapMinMs); expect(cur.glyph).toBe('question')
  })
})

describe('limpeza de timers', () => {
  it('dispose zera todos os timers (idle, demo, glifo, notebook, sono)', () => {
    make(() => 0); feed({}); expect(vi.getTimerCount()).toBeGreaterThan(0)
    adv(T.demoMinMs + T.laptopMoveMs + T.demoTypeMs) // no meio do "?"
    ctl.dispose(); expect(vi.getTimerCount()).toBe(0)
    const n = log.length; adv(60 * 60_000); expect(log.length).toBe(n)
  })
  it('trocar de estado várias vezes não acumula timers', () => {
    make(); const modes: PetState[] = ['IDLE', 'WORKING', 'UNKNOWN', 'IDLE', 'THINKING', 'ERROR', 'IDLE']
    for (let i = 0; i < 50; i++) feed({ mode: modes[i % modes.length] })
    expect(vi.getTimerCount()).toBeLessThanOrEqual(5)
    ctl.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('setInput idêntico (snapshots repetidos) não reinicia timers', () => {
    make(() => 0); feed({}); adv(1000)
    for (let i = 0; i < 20; i++) feed({})
    adv(T.gazeMinMs - 1000); expect(cur.gaze).not.toBe(0) // no tempo original, não reiniciado
  })
})
