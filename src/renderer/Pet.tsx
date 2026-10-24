import { useEffect, useRef, useState } from 'react'
import { luminance, type Skin } from '../shared/skins'
import { BODY, BODY_SIDE, LAPTOP_PAD } from '../shared/sprites'
import { memberStatus } from '../shared/agentTeams'
import { isActive, resolveAgent } from '../shared/teams'
import type { AppSnapshot, PetState } from '../shared/types'
import type { Gaze, Glyph, Laptop } from './mascot/controller'
import { T } from './mascot/timings'
import { useMascotVisual } from './mascot/useMascotVisual'

type R = [number, number, number, number]
const rects = (l: R[], fill: string, key: string) => l.map(([x, y, w, h], i) => <rect key={key + i} x={x} y={y} width={w} height={h} fill={fill} />)
const pix = (pts: [number, number][], x0: number, y0: number, fill: string, key: string) =>
  pts.map(([x, y], i) => <rect key={key + i} x={x0 + x} y={y0 + y} width={1} height={1} fill={fill} />)

const GLYPH = {
  '?': [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2], [1, 4]],
  '!': [[1, 0], [1, 1], [1, 2], [1, 4]],
  Z: [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]]
} as Record<string, [number, number][]>

// Elementos fixos: NÃO mudam com a skin (exportados p/ o relatório de contraste)
export const GLYPH_COLOR = { question: '#ffd166', bang: '#4ade80' } as const // "?" amarelo (como antes); "!" verde = concluído
export const PERMISSION = '#fbbf24' // placa de atenção: âmbar, forma de placa (nunca confundir com o "!" verde flutuante)

// Contorno da skin (flag outline): anel de 1 "pixel" (sem anti-aliasing) em volta de um conjunto de pixels
type P2 = [number, number]
const N4: P2[] = [[0, -1], [-1, 0], [1, 0], [0, 1]]
function ring(pts: P2[], n: P2[]): P2[] {
  const has = new Set(pts.map(([x, y]) => `${x},${y}`)), out = new Map<string, P2>()
  for (const [x, y] of pts) for (const [dx, dy] of n) { const k = `${x + dx},${y + dy}`; if (!has.has(k)) out.set(k, [x + dx, y + dy]) }
  return [...out.values()]
}
const INK_DARK = '#1d1410', INK_LIGHT = '#eef1f6'

const EYE_OPEN: R[] = [[4, 3, 2, 2], [10, 3, 2, 2]]
const EYE_LINE: R[] = [[4, 4, 2, 1], [10, 4, 2, 1]]
const EYE_DOWN: R[] = [[4, 4, 2, 2], [10, 4, 2, 2]]
const EYE_TALL: R[] = [[4, 3, 2, 3], [10, 3, 2, 3]]

interface Props {
  state: PetState | 'SLEEPING'; skin: Skin; busyTool: boolean; hover: boolean; dragging: boolean; animate: boolean
  gaze?: Gaze; laptop?: Laptop; glyph?: Glyph; glyphN?: number
}

/**
 * Notebook de lado, à esquerda do pet (pose BODY_SIDE): tampa inclinada para trás, luz da tela voltada para o pet,
 * base no chão. Mesmas classes do notebook antigo (pegar/guardar, mãos alternando, linhas piscando: CSS, sem JS).
 */
// Desenho do usuário, 1:1 com o pixel do mascote (10x6): tampa de 3 tons (borda escura, face clara, tela ciano) descendo
// em diagonal até a dobradiça e teclado de 2 linhas (topo claro, base escura). Fica inteiro à esquerda do corpo, nas
// colunas -5..4 (a janela do pet tem LAPTOP_PAD colunas extras à esquerda); o teclado termina onde o corpo começa.
const LAP_DARK = '#585858', LAP_LIGHT = '#c3c3c3', LAP_SCREEN = '#8cfffb'
const LX = -LAPTOP_PAD + 1, LY = 7 // canto superior esquerdo do desenho (teclado encostado no corpo)
function LaptopSprite({ phase, animate, body }: { phase: Laptop; animate: boolean; body: string }) {
  return (
    <g className={`laptop ${phase} ${animate ? 'anim' : ''}`}>
      {pix([[0, 0], [0, 1], [1, 2], [2, 3], [3, 4]], LX, LY, LAP_DARK, 'le')}
      {pix([[1, 0], [1, 1], [2, 2], [3, 3]], LX, LY, LAP_LIGHT, 'lf')}
      <g className="ln l1">{pix([[2, 0], [2, 1]], LX, LY, LAP_SCREEN, 'a')}</g>
      <g className="ln l2">{pix([[3, 2], [4, 3]], LX, LY, LAP_SCREEN, 'b')}</g>
      {rects([[LX + 4, LY + 4, 5, 1]], LAP_LIGHT, 'kb')}
      {rects([[LX + 4, LY + 5, 5, 1]], LAP_DARK, 'base')}
      {/* mãos sobre o teclado (lado direito, junto ao corpo), como no notebook de frente: alternam subindo 1px */}
      <g className="hand hl">{rects([[3, 10, 1, 1]], body, 'hl')}</g>
      <g className="hand hr">{rects([[4, 10, 1, 1]], body, 'hr')}</g>
    </g>
  )
}

export function PetSprite({ state, skin, busyTool, hover, dragging, animate, gaze = 0, laptop = 'none', glyph = 'none', glyphN = 0 }: Props) {
  const { body: O, shade: D, eye: K, cheek: P, accent: A } = skin.palette
  const pal = { O, D, K, P, A }
  const { outline, eyeGlow, animatedColor } = skin.flags
  const darkBody = luminance(O) < 0.2
  // com notebook o pet vira 3/4 para a esquerda (BODY_SIDE); o rosto acompanha: metade esquerda anda 1 coluna
  const side = laptop !== 'none'
  const fx = (x: number) => (side && x < 8 ? x + 1 : x)
  const E = (l: R[]): R[] => (side ? l.map(([x, y, w, h]) => [fx(x), y, w, h]) : l)
  const cells = (side ? BODY_SIDE : BODY).flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' ? [] : [[x, y, c] as const])))
  let body: React.ReactNode = cells.map(([x, y, c]) => <rect key={`b${x}-${y}`} x={x} y={y} width={1} height={1} fill={skin.bodyRows?.[y] ?? pal[c as 'O']} />)
  if (animatedColor && animate) body = <g className="huecycle">{body}</g>
  // contorno fora do corpo (não altera a máscara do corpo); vãos entre as pernas ficam livres
  const bodyOutline = outline && ring(cells.map(([x, y]) => [x, y]), N4).filter(([x, y]) => !(y >= 11 && x >= 2 && x <= 13))
    .map(([x, y]) => <rect key={`o${x}-${y}`} x={x} y={y} width={1} height={1} fill={darkBody ? INK_LIGHT : INK_DARK} opacity=".35" />)
  const typing = laptop === 'typing' || laptop === 'taking'

  let eyes: React.ReactNode
  let extra: React.ReactNode = null
  let eyeClass = ''
  if (dragging) {
    eyes = rects(E(EYE_TALL), K, 'e')
    extra = rects(E([[7, 6, 2, 2]]), K, 'm')
  } else switch (state) {
    case 'THINKING':
    case 'WORKING':
      eyes = rects(E(EYE_DOWN), K, 'e')
      extra = busyTool && (
        <g className="spin" style={{ transformOrigin: '14px -2px' }}>
          {pix([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 13, -3, A, 'g')}
          {pix([[0, 0], [2, 0], [0, 2], [2, 2]], 13, -3, pal.D, 'g2')}
        </g>
      )
      break
    case 'WAITING_PERMISSION':
      eyes = rects(E(EYE_OPEN), K, 'e')
      extra = (
        <g className="wave">
          {rects([[14, 0, 1, 8]], '#8a6a3b', 'pole')}
          {rects([[11, -5, 5, 5]], PERMISSION, 'sg')}
          {pix(GLYPH['!'], 12, -4.5, K, 'x')}
        </g>
      ); break
    case 'COMPLETED': // só enquanto o "!" está na tela
      eyes = pix([[0, 1], [1, 0], [2, 1]], fx(4), 3, K, 'e').concat(pix([[0, 1], [1, 0], [2, 1]], 9, 3, K, 'e2'))
      extra = (
        <g className="pulse">
          {pix([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 0, -3, A, 's1')}
          {pix([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], 13, -4, A, 's2')}
          {rects(E([[6, 6, 4, 1]]), K, 'sm')}
        </g>
      ); break
    case 'ERROR':
      eyes = rects(E(EYE_OPEN), K, 'e')
      extra = (
        <g>
          {rects(E([[4, 1, 2, 1], [10, 1, 2, 1]]), K, 'br')}
          <g className="drip">{rects([[13, 2, 1, 2]], '#7dd3fc', 'sw')}</g>
          {rects(E([[6, 7, 4, 1]]), K, 'mo')}
        </g>
      ); break
    case 'DISCONNECTED':
      eyes = [[4, 3], [6, 3], [5, 4], [4, 5], [6, 5], [9, 3], [11, 3], [10, 4], [9, 5], [11, 5]].map(([x, y], i) => <rect key={'x' + i} x={fx(x)} y={y} width={1} height={1} fill={K} />)
      extra = <g opacity=".7">{rects(E([[6, 7, 4, 1]]), K, 'mo')}</g>
      break
    case 'SLEEPING':
      eyes = rects(E(EYE_LINE), K, 'e')
      extra = <g className="float">{pix(GLYPH.Z, 11, 0, '#cbd5e1', 'z')}{pix(GLYPH.Z, 13, -2.5, '#cbd5e1', 'z2')}</g>
      break
    default: // IDLE | UNKNOWN
      eyes = rects(E(typing ? EYE_DOWN : EYE_OPEN), K, 'e'); eyeClass = typing ? '' : 'eyes-idle'
  }
  if (hover && !dragging && (state === 'IDLE' || state === 'UNKNOWN')) extra = <>{extra}{rects(side ? [[5, 5, 1, 1], [12, 5, 1, 1]] : [[3, 5, 1, 1], [12, 5, 1, 1]], pal.P, 'ch')}</>

  const cls = ['sprite', `st-${state}`, animate ? 'anim' : '', hover ? 'hover' : '', dragging ? 'drag' : ''].join(' ')
  const showGaze = !dragging && (state === 'IDLE' || state === 'UNKNOWN') && !typing && !side // de lado, olha para o notebook
  return (
    <svg viewBox="0 -6 16 20" width="100%" height="100%" shapeRendering="crispEdges" style={{ pointerEvents: 'none', overflow: 'visible' }}>
      <ellipse cx="8" cy="13.6" rx="6" ry=".7" fill="#000" opacity=".18" />
      <g className={cls} style={{ pointerEvents: 'visiblePainted' }}>
        <g className="bodyfx">
          {bodyOutline}
          {body}
          <g transform={showGaze ? `translate(${gaze} 0)` : undefined}>{eyeGlow ? <g className="eyeglow"><g className={eyeClass}>{eyes}</g></g> : <g className={eyeClass}>{eyes}</g>}</g>
          {extra}
          {side && <LaptopSprite phase={laptop} animate={animate} body={pal.O} />}
          {glyph !== 'none' && (
            <g key={glyphN} className="glyph"><g className="gbounce">{pix(GLYPH[glyph === 'bang' ? '!' : '?'], 7, -4, GLYPH_COLOR[glyph], 'gl')}</g></g>
          )}
        </g>
      </g>
    </svg>
  )
}

export function useHidden() {
  const [h, setH] = useState(document.hidden)
  useEffect(() => {
    const f = () => setH(document.hidden)
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return h
}

export function Pet({ snap }: { snap: AppSnapshot }) {
  const { settings, display } = snap
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const hidden = useHidden()
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)
  const clickTimer = useRef<number | null>(null)
  const ses = snap.sessions.find((s) => s.id === display.sessionId)
  const animate = settings.animations && !settings.reduceMotion
  // chave de UMA conclusão (Stop): sessão + instante em que entrou em COMPLETED
  const completionKey = display.state === 'COMPLETED' ? `${display.sessionId}:${ses?.stateSince ?? 0}` : null
  const vis = useMascotVisual({ mode: display.state, completionKey, animate, paused: hover || dragging || hidden })
  // indicador discreto: agentes de equipe ativos (some quando é 0)
  const agents = (snap.teams ?? []).flatMap((t) => t.agents)
    .filter((a) => a.sessionId && isActive(resolveAgent(a, snap.sessions).st)).length
    + (snap.agentTeams ?? []).reduce((n, t) => n + t.members.filter((m) => isActive(memberStatus(t, m, snap.sessions.find((s) => s.id === t.leadSessionId)))).length, 0)

  useEffect(() => window.pet.onSound(beep(settings.volume)), [settings.volume])
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current) }, [])

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { x: e.screenX, y: e.screenY, moved: false, id: e.pointerId }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const dx = e.screenX - d.x, dy = e.screenY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return // limiar: distingue clique de arraste
    if (!d.moved) { d.moved = true; setDragging(true) }
    window.pet.dragBy(dx, dy); d.x = e.screenX; d.y = e.screenY
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null
    if (!d) return
    ;(e.currentTarget as Element).releasePointerCapture?.(d.id)
    if (d.moved) { setDragging(false); window.pet.dragEnd(); return }
    if (settings.doubleClick === 'none') return window.pet.petClick()
    if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; window.pet.petDouble() }
    else clickTimer.current = window.setTimeout(() => { clickTimer.current = null; window.pet.petClick() }, 260)
  }

  return (
    <div className={`pet-root ${animate ? '' : 'noanim'}`} title={display.label}
      style={{ opacity: settings.opacity, ['--type-ms' as string]: `${T.typeFrameMs}ms`, ['--glyph-ms' as string]: `${T.glyphMs}ms`, ['--move-ms' as string]: `${T.laptopMoveMs}ms` }}
      onContextMenu={(e) => { e.preventDefault(); window.pet.petMenu() }}>
      <div
        className="pet-hit"
        onPointerEnter={() => { setHover(true); window.pet.ignoreMouse(false) }}
        onPointerLeave={() => { if (!drag.current) { setHover(false); window.pet.ignoreMouse(true) } }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      >
        <PetSprite state={vis.state} skin={snap.skin} busyTool={!!ses?.tool} hover={hover} dragging={dragging} animate={animate}
          gaze={vis.gaze} laptop={vis.laptop} glyph={vis.glyph} glyphN={vis.glyphN} />
        {agents > 0 && <span className="pet-agents" aria-label={`${agents} agentes ativos`}>{agents}</span>}
      </div>
    </div>
  )
}

function beep(volume: number) {
  let ctx: AudioContext | null = null
  return (kind: 'done' | 'ask' | 'error') => {
    try {
      ctx ??= new AudioContext()
      const notes = kind === 'done' ? [660, 880] : kind === 'ask' ? [740, 740] : [220]
      notes.forEach((f, i) => {
        const o = ctx!.createOscillator(), g = ctx!.createGain()
        o.type = 'square'; o.frequency.value = f
        const t = ctx!.currentTime + i * 0.14
        g.gain.setValueAtTime(0.08 * volume, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
        o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.13)
      })
    } catch { /* áudio indisponível */ }
  }
}
