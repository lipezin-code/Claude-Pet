import type { Gaze, Glyph, Laptop } from '../src/renderer/mascot/controller'
import type { PetState } from '../src/shared/types'

// Enumeração determinística de TODAS as combinações de props visuais do PetSprite.
// A ordem não pode mudar: a fixture guarda um hash por índice.
export interface SpriteCase {
  state: PetState | 'SLEEPING'; busyTool: boolean; hover: boolean; dragging: boolean; animate: boolean
  gaze: Gaze; laptop: Laptop; glyph: Glyph
}
const STATES = ['IDLE', 'THINKING', 'WORKING', 'WAITING_PERMISSION', 'COMPLETED', 'ERROR', 'DISCONNECTED', 'UNKNOWN', 'SLEEPING'] as const
const B = [false, true]

export const SPRITE_CASES: SpriteCase[] = STATES.flatMap((state) => B.flatMap((busyTool) => B.flatMap((hover) => B.flatMap((dragging) => B.flatMap((animate) =>
  ([-1, 0, 1] as Gaze[]).flatMap((gaze) => (['none', 'taking', 'typing', 'held', 'stowing'] as Laptop[]).flatMap((laptop) =>
    (['none', 'question', 'bang'] as Glyph[]).map((glyph) => ({ state, busyTool, hover, dragging, animate, gaze, laptop, glyph }))))))))
)
export const caseLabel = (c: SpriteCase) => Object.values(c).join('|')
