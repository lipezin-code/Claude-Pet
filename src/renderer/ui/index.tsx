import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { PetState } from '../../shared/types'
import './ui.css'

export function IconButton({ label, accent, sm, children, ...p }: { label: string; accent?: boolean; sm?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-label={label} title={label} className={`ui-ibtn ${accent ? 'accent' : ''} ${sm ? 'sm' : ''}`} {...p}>{children}</button>
}

export function Button({ primary, sm, children, ...p }: { primary?: boolean; sm?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ui-btn ${primary ? 'primary' : ''} ${sm ? 'sm' : ''}`} {...p}>{children}</button>
}

/** Ação destrutiva em 2 cliques: o 1º arma ("Confirmar?"), o 2º executa; desarma sozinho em 3 s. Sem diálogo. */
export function ConfirmButton({ label, confirmLabel = 'Confirmar?', onConfirm, children, sm, icon, ...p }: { label: string; confirmLabel?: string; onConfirm: () => void; children?: ReactNode; sm?: boolean; icon?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t) }, [armed])
  const cls = icon && !armed ? `ui-ibtn ${sm ? 'sm' : ''}` : `ui-btn ${sm ? 'sm' : ''} ${armed ? 'danger' : ''}`
  return <button type="button" aria-label={armed ? `${confirmLabel} ${label}` : label} title={label} className={cls} {...p}
    onClick={(e) => { e.stopPropagation(); if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>{armed ? confirmLabel : children ?? label}</button>
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="ui-toggle" onClick={() => onChange(!checked)} />
}

export function Slider({ value, min, max, step, onChange, onLive, label, minLabel, maxLabel }: {
  value: number; min: number; max: number; step: number; onChange: (v: number) => void; onLive?: (v: number) => void
  label: string; minLabel?: string; maxLabel?: string
}) {
  // valor local = thumb responde na hora; onChange (IPC) sai no máx. 1x por frame e é garantido ao soltar
  const [v, setV] = useState(value)
  const dragging = useRef(false)
  const raf = useRef(0)
  const pend = useRef(value)
  useEffect(() => { if (!dragging.current) setV(value) }, [value])
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])
  const flush = () => { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0 } onChange(pend.current) }
  const pct = `${((v - min) / (max - min)) * 100}%`
  return (
    <div className="ui-slider">
      <div className="row">
        <input type="range" aria-label={label} min={min} max={max} step={step} value={v} style={{ ['--pct' as string]: pct }}
          onPointerDown={() => { dragging.current = true }}
          onPointerUp={() => { dragging.current = false; flush() }}
          onPointerCancel={() => { dragging.current = false; flush() }}
          onChange={(e) => {
            const n = +e.target.value
            setV(n); pend.current = n; onLive?.(n)
            if (!dragging.current) onChange(n) // teclado / roda do mouse
            else if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; onChange(pend.current) })
          }} />
      </div>
      {(minLabel || maxLabel) && <div className="ends"><span>{minLabel}</span><span>{maxLabel}</span></div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="ui-seg" role="tablist">
      {options.map((o) => <button key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  )
}

export function Tile({ icon, label, value, on, onClick, right }: { icon: ReactNode; label: string; value: ReactNode; on?: boolean; onClick?: () => void; right?: ReactNode }) {
  const body = (
    <>
      <span className="ic">{icon}{right}</span>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </>
  )
  return onClick
    ? <button type="button" className={`ui-tile ${on ? 'on' : ''}`} onClick={onClick}>{body}</button>
    : <div className={`ui-tile ${on ? 'on' : ''}`}>{body}</div>
}

/** Mapa único estado -> cor semântica. */
export function stateTone(s: PetState | 'SLEEPING'): 'work' | 'done' | 'ask' | 'err' | 'off' {
  switch (s) {
    case 'THINKING': case 'WORKING': return 'work'
    case 'COMPLETED': case 'IDLE': case 'SLEEPING': return 'done'
    case 'WAITING_PERMISSION': return 'ask'
    case 'ERROR': return 'err'
    default: return 'off'
  }
}

export function StateChip({ state, children }: { state: PetState | 'SLEEPING'; children: ReactNode }) {
  const tone = stateTone(state)
  return <span className={`ui-chip ${tone}`}><span className={`ui-dot ${tone}`} /><span className="txt">{children}</span></span>
}
