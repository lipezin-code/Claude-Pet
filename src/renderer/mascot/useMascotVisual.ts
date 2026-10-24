import { useEffect, useRef, useState } from 'react'
import { MascotController, type Input, type Visual } from './controller'

const INITIAL: Visual = { state: 'IDLE', gaze: 0, laptop: 'none', glyph: 'none', glyphN: 0 }

/** Liga o controlador puro ao React. Timers morrem no cleanup (inclusive no StrictMode). */
export function useMascotVisual(input: Input): Visual {
  const [v, setV] = useState<Visual>(INITIAL)
  const ctl = useRef<MascotController | null>(null)
  useEffect(() => {
    const c = new MascotController(setV)
    ctl.current = c
    return () => { c.dispose(); ctl.current = null }
  }, [])
  useEffect(() => { ctl.current?.setInput(input) }, [input.mode, input.completionKey, input.animate, input.paused]) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}
