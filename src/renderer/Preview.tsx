import { PetSprite } from './Pet'
import type { Gaze, Glyph, Laptop } from './mascot/controller'
import { T } from './mascot/timings'
import type { PetState } from '../shared/types'
import { CLASSICO } from '../shared/skins'
import { PREVIEW_SKINS } from './previewSkins'
import { LAPTOP_PAD } from '../shared/sprites'

// Ferramenta de QA visual (rota #preview). Não usa IPC e não altera nada do app.
interface Cell { label: string; state: PetState | 'SLEEPING'; gaze?: Gaze; laptop?: Laptop; glyph?: Glyph; busy?: boolean }
const CELLS: Cell[] = [
  { label: 'IDLE frente', state: 'IDLE' }, { label: 'IDLE esquerda', state: 'IDLE', gaze: -1 }, { label: 'IDLE direita', state: 'IDLE', gaze: 1 },
  { label: 'digitando', state: 'WORKING', laptop: 'typing' }, { label: 'digitando+ferramenta', state: 'WORKING', laptop: 'typing', busy: true },
  { label: 'pegando', state: 'IDLE', laptop: 'taking' }, { label: 'demo: ?', state: 'IDLE', laptop: 'held', glyph: 'question' },
  { label: 'concluiu: !', state: 'COMPLETED', glyph: 'bang' }, { label: 'permissão', state: 'WAITING_PERMISSION' },
  { label: 'erro', state: 'ERROR' }, { label: 'desconectado', state: 'DISCONNECTED' }, { label: 'dormindo', state: 'SLEEPING' },
  { label: 'UNKNOWN ?', state: 'UNKNOWN', glyph: 'question' }
]

export function Preview() {
  const scales = [3, 6, 12] // px por "pixel" => 50%, 100%, 200%
  const animate = !location.search.includes('static')
  return (
    <div style={{ background: '#2a2d36', color: '#ddd', padding: 12, font: '12px Segoe UI', userSelect: 'text', overflow: 'auto', height: '100vh' }}>
      {scales.map((u) => (
        <div key={u} style={{ marginBottom: 14 }}>
          <b>{Math.round((u / 6) * 100)}%</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, ['--type-ms' as string]: `${T.typeFrameMs}ms`, ['--glyph-ms' as string]: `${T.glyphMs}ms`, ['--move-ms' as string]: `${T.laptopMoveMs}ms` }}>
            {CELLS.map((c) => (
              <div key={c.label} style={{ textAlign: 'center' }}>
                <div style={{ width: (16 + LAPTOP_PAD) * u, paddingLeft: LAPTOP_PAD * u, boxSizing: 'border-box', height: 20 * u, background: '#14161b' }}>
                  <PetSprite state={c.state} skin={CLASSICO} busyTool={!!c.busy} hover={false} dragging={false} animate={animate} gaze={c.gaze} laptop={c.laptop} glyph={c.glyph} glyphN={1} />
                </div>
                {u === 6 && <div style={{ maxWidth: 96 }}>{c.label}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Folha de aprovação das skins (rota #preview-skins; capturada por scripts/skins-preview.mjs -> docs/skins-preview.png)
const KEY: Cell[] = [
  { label: 'frente', state: 'IDLE' }, { label: 'esquerda', state: 'IDLE', gaze: -1 }, { label: 'direita', state: 'IDLE', gaze: 1 },
  { label: 'digitando', state: 'WORKING', laptop: 'typing' }, { label: '"?"', state: 'IDLE', laptop: 'held', glyph: 'question' },
  { label: 'concluiu "!"', state: 'COMPLETED', glyph: 'bang' }, { label: 'permissão', state: 'WAITING_PERMISSION' }, { label: 'dormindo', state: 'SLEEPING' }
]
export function PreviewSkins() {
  const u = 6 // 100%
  const panel = (bg: string, fg: string) => (
    <div style={{ background: bg, color: fg, padding: '10px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${KEY.length}, ${(16 + LAPTOP_PAD) * u}px)`, gap: '6px 4px', alignItems: 'center' }}>
        <span />{KEY.map((c) => <b key={c.label} style={{ textAlign: 'center' }}>{c.label}</b>)}
        {PREVIEW_SKINS.map((s) => [
          <b key={s.id}>{s.name}</b>,
          ...KEY.map((c) => (
            <div key={s.id + c.label} style={{ width: (16 + LAPTOP_PAD) * u, paddingLeft: LAPTOP_PAD * u, boxSizing: 'border-box', height: 20 * u }}>
              <PetSprite state={c.state} skin={s} busyTool={false} hover={false} dragging={false} animate={false} gaze={c.gaze} laptop={c.laptop} glyph={c.glyph} glyphN={1} />
            </div>
          ))
        ])}
      </div>
    </div>
  )
  return <div id="sheet" style={{ display: 'inline-block', font: '12px Segoe UI' }}>{panel('#14161b', '#e5e7eb')}{panel('#f3f4f6', '#111827')}</div>
}
