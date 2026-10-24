import type { PetState } from '../../shared/types'
import { T as DEFAULT_T, type Timings } from './timings'

export type Gaze = -1 | 0 | 1
export type Laptop = 'none' | 'taking' | 'typing' | 'held' | 'stowing'
export type Glyph = 'none' | 'question' | 'bang'

/** O que o renderer desenha. `state` já inclui SLEEPING e o COMPLETED "de comemoração". */
export interface Visual {
  state: PetState | 'SLEEPING'
  gaze: Gaze
  laptop: Laptop
  glyph: Glyph
  glyphN: number // muda a cada novo glifo (reinicia a animação CSS)
}

export interface Input {
  mode: PetState // estado exibido (já escolhido pela política de sessões no main)
  completionKey: string | null // identifica UMA conclusão (sessão + stateSince); null fora de COMPLETED
  animate: boolean // animações ligadas e sem "reduzir movimento"
  paused: boolean // hover, arraste ou janela oculta
}

type Handle = ReturnType<typeof setTimeout>
const WORK: PetState[] = ['THINKING', 'WORKING']
const STATIC: PetState[] = ['WAITING_PERMISSION', 'ERROR', 'DISCONNECTED']

/**
 * Controlador puro do visual do mascote (sem React, sem IPC, sem mudar estado real do app).
 * Regras: trabalho = digitando sem parar; "!" só na entrada em COMPLETED (Stop); "?" e olhares são
 * decorativos e morrem na hora quando chega estado de trabalho. Todo timer fica registrado
 * e é limpo em dispose()/troca de estado.
 */
export class MascotController {
  private v: Visual = { state: 'IDLE', gaze: 0, laptop: 'none', glyph: 'none', glyphN: 0 }
  private last = ''
  private inp: Input | null = null
  private handledKey: string | null = null
  private decor = new Set<Handle>()
  private glyphT: Handle | null = null
  private glyphOwner: 'decor' | 'bang' | null = null
  private laptopT: Handle | null = null
  private sleepT: Handle | null = null
  private sleeping = false
  private celebrating = false
  private busy = false // demo/ciclo UNKNOWN em andamento: olhar fica parado
  private epoch = 0
  private disposed = false

  constructor(
    private onChange: (v: Visual) => void,
    private t: Timings = DEFAULT_T,
    private rnd: () => number = Math.random
  ) {}

  setInput(inp: Input) {
    if (this.disposed) return
    const prev = this.inp
    if (prev && prev.mode === inp.mode && prev.completionKey === inp.completionKey && prev.animate === inp.animate && prev.paused === inp.paused) return
    if (!prev) this.handledKey = inp.completionKey // conclusão que já existia ao abrir não dispara "!"
    this.inp = inp
    const modeChanged = !prev || prev.mode !== inp.mode
    if (modeChanged) {
      this.stopDecor(WORK.includes(inp.mode))
      this.clearGlyph()
      this.cancelSleep(); this.sleeping = false
      this.celebrating = false
    } else {
      this.stopDecor(false) // animate/paused mudou: reinicia só o decorativo
    }
    this.reconcile()
  }

  dispose() {
    this.disposed = true
    this.stopDecor(false); this.clearGlyph(); this.cancelSleep()
    if (this.laptopT) clearTimeout(this.laptopT)
    this.laptopT = null
  }

  // ---------- núcleo ----------
  private reconcile() {
    const { mode, animate, paused } = this.inp!
    if (WORK.includes(mode)) {
      this.v.gaze = 0
      this.pullLaptop(animate)
      return this.emit(mode)
    }
    if (this.v.laptop === 'taking' || this.v.laptop === 'typing') this.stowLaptop() // saiu do trabalho
    if (STATIC.includes(mode)) { this.v.gaze = 0; return this.emit(mode) }

    // IDLE | COMPLETED | UNKNOWN
    const k = this.inp!.completionKey
    if (mode === 'COMPLETED' && k && k !== this.handledKey) {
      this.handledKey = k
      this.celebrating = true
      this.showGlyph('bang', 'bang')
    }
    if (mode === 'IDLE' && !this.sleeping && !this.sleepT) {
      this.sleepT = setTimeout(() => { this.sleepT = null; this.sleeping = true; this.stopDecor(false); this.reconcile() }, this.t.sleepAfterMs)
    }
    if (animate && !paused && !this.sleeping && !this.celebrating) this.startDecor(mode)
    else this.v.gaze = 0
    const shown: Visual['state'] = mode === 'COMPLETED' ? (this.celebrating ? 'COMPLETED' : 'IDLE') : mode === 'IDLE' && this.sleeping ? 'SLEEPING' : mode
    this.emit(shown)
  }

  // ---------- decorativo ----------
  private after(ms: number, fn: () => void) {
    const ep = this.epoch
    const h = setTimeout(() => { this.decor.delete(h); if (ep === this.epoch && !this.disposed) fn() }, ms)
    this.decor.add(h)
  }
  private rand(a: number, b: number) { return a + (b - a) * this.rnd() }

  private startDecor(mode: PetState) {
    this.gazeLoop()
    if (mode === 'UNKNOWN') this.unknownLoop(0)
    else this.demoLoop()
  }

  private stopDecor(keepLaptop: boolean) {
    this.epoch++
    for (const h of this.decor) clearTimeout(h)
    this.decor.clear()
    this.busy = false
    this.v.gaze = 0
    if (this.glyphOwner === 'decor') this.clearGlyph()
    if (!keepLaptop && (this.v.laptop === 'taking' || this.v.laptop === 'typing' || this.v.laptop === 'held')) this.stowLaptop()
  }

  private gazeLoop() {
    this.after(this.rand(this.t.gazeMinMs, this.t.gazeMaxMs), () => {
      if (!this.busy) {
        const opts = ([-1, 0, 1] as Gaze[]).filter((g) => g !== this.v.gaze)
        this.v.gaze = opts[Math.min(opts.length - 1, Math.floor(this.rnd() * opts.length))]
        this.emit(this.v.state)
      }
      this.gazeLoop()
    })
  }

  /** pega o notebook, digita `typeMs`, e chama `done` (notebook segue na mão, em 'held'). */
  private typeSequence(typeMs: number, done: () => void) {
    this.busy = true; this.v.gaze = 0
    this.pullLaptop(true)
    this.emit(this.v.state)
    this.after(this.t.laptopMoveMs + typeMs, () => { this.v.laptop = 'held'; done() })
  }
  private endSequence(then: () => void) {
    this.stowLaptop()
    this.emit(this.v.state)
    this.after(this.t.laptopMoveMs, () => { this.busy = false; then() })
  }
  private questionFor(then: () => void) {
    this.showGlyph('question', 'decor')
    this.after(this.t.glyphMs, () => { this.clearGlyph(); this.emit(this.v.state); then() })
  }

  /** IDLE: de tempos em tempos digita ~3s, mostra "?" ~3s, guarda o notebook. */
  private demoLoop() {
    this.after(this.rand(this.t.demoMinMs, this.t.demoMaxMs), () => {
      this.typeSequence(this.t.demoTypeMs, () => this.questionFor(() => this.endSequence(() => this.demoLoop())))
    })
  }

  /** UNKNOWN: alterna "?" (3s) e digitar (3s), com pausas olhando ao redor. */
  private unknownLoop(n: number) {
    this.after(this.rand(this.t.unknownGapMinMs, this.t.unknownGapMaxMs), () => {
      if (n % 2 === 0) { this.busy = true; this.questionFor(() => { this.busy = false; this.unknownLoop(n + 1) }) }
      else this.typeSequence(this.t.unknownTypeMs, () => this.endSequence(() => this.unknownLoop(n + 1)))
    })
  }

  // ---------- notebook ----------
  private pullLaptop(animate: boolean) {
    if (this.laptopT) { clearTimeout(this.laptopT); this.laptopT = null }
    if (this.v.laptop === 'typing' || this.v.laptop === 'taking') return
    if (!animate || this.v.laptop === 'held') { this.v.laptop = 'typing'; return }
    this.v.laptop = 'taking'
    this.laptopT = setTimeout(() => { this.laptopT = null; this.v.laptop = 'typing'; this.emit(this.v.state) }, this.t.laptopMoveMs)
  }
  private stowLaptop() {
    if (this.laptopT) clearTimeout(this.laptopT)
    if (this.v.laptop === 'none') return
    if (this.inp && !this.inp.animate) { this.v.laptop = 'none'; this.laptopT = null; return }
    this.v.laptop = 'stowing'
    this.laptopT = setTimeout(() => { this.laptopT = null; this.v.laptop = 'none'; this.emit(this.v.state) }, this.t.laptopMoveMs)
  }

  // ---------- glifos ----------
  private showGlyph(g: Exclude<Glyph, 'none'>, owner: 'decor' | 'bang') {
    if (this.glyphT) clearTimeout(this.glyphT)
    this.v.glyph = g; this.v.glyphN++; this.glyphOwner = owner
    this.glyphT = setTimeout(() => {
      this.glyphT = null
      const wasBang = this.glyphOwner === 'bang'
      this.v.glyph = 'none'; this.glyphOwner = null
      if (wasBang) { this.celebrating = false; this.reconcile() } else this.emit(this.v.state)
    }, this.t.glyphMs)
    this.emit(this.v.state)
  }
  private clearGlyph() {
    if (this.glyphT) clearTimeout(this.glyphT)
    this.glyphT = null; this.glyphOwner = null; this.v.glyph = 'none'
  }
  private cancelSleep() { if (this.sleepT) clearTimeout(this.sleepT); this.sleepT = null }

  private emit(state: Visual['state']) {
    this.v.state = state
    const key = `${state}|${this.v.gaze}|${this.v.laptop}|${this.v.glyph}|${this.v.glyphN}`
    if (key === this.last) return
    this.last = key
    this.onChange({ ...this.v })
  }
}
