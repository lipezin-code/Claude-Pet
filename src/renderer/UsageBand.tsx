import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppSnapshot } from '../shared/types'
import { bandModel, fmtAgo, fmtPct, type Meter } from '../shared/usage'
import './usage.css'

const C = 2 * Math.PI * 16

/** Anel SVG (viewBox 40, r 16, traço 3,5, começa no topo). Sem dado = só o trilho. */
export function Ring({ m, size }: { m: Meter; size: number }) {
  const text = `${m.label}: ${m.pct == null ? 'sem dado' : fmtPct(m.pct)}${m.sub !== '—' ? `, ${m.sub}` : ''}${m.stale ? ' (desatualizado)' : ''}`
  return (
    <div className={`ub-ring ${m.level}`} style={{ width: size, height: size }} role="meter" aria-label={m.label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pct == null ? undefined : Math.round(m.pct)} aria-valuetext={text}>
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <circle className="ub-track" cx="20" cy="20" r="16" />
        {m.pct != null && m.pct > 0 && (
          <circle className="ub-fill" cx="20" cy="20" r="16" strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(100, m.pct) / 100)} transform="rotate(-90 20 20)" />
        )}
      </svg>
      <span className="ub-pct">{fmtPct(m.pct)}</span>
    </div>
  )
}

/** Faixa de uso do mini chat (entre as abas e a conversa). Só desenha números já validados pelo main. */
export function UsageBand({ snap }: { snap: AppSnapshot }) {
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState(snap.settings.usageBandExpanded)
  useEffect(() => setOpen(snap.settings.usageBandExpanded), [snap.settings.usageBandExpanded])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])
  useEffect(() => setNow(Date.now()), [snap.usage])

  const sid = snap.display.sessionId
  const meters = bandModel(snap.usage, sid, now)
  const sess = sid ? snap.sessions.find((s) => s.id === sid) : undefined
  const su = sid ? snap.usage.sessions[sid] : undefined
  const at = su?.updatedAt ?? snap.usage.account?.updatedAt
  const toggle = () => { setOpen(!open); window.pet.setSettings({ usageBandExpanded: !open }) }
  const still = snap.settings.reduceMotion ? ' still' : ''
  const arrow = (
    <button type="button" className="ub-arrow" aria-expanded={open} aria-controls="ub-body" aria-label={open ? 'Recolher faixa de uso' : 'Expandir faixa de uso'} title={open ? 'Recolher' : 'Expandir'} onClick={toggle}>
      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
    </button>
  )
  const foot = !at
    ? snap.statusBridge === 'installed' || snap.statusBridge === 'chained' ? 'Sem dados ainda: aguardando o Claude Code redesenhar a status line' : 'Faixa de uso não instalada (Configurações › Claude Code)'
    : `Sessão ${sess?.project ?? 'nenhuma'} · atualizado ${fmtAgo(at, now)}`

  return (
    <section className={`ub${open ? ' open' : ''}${still}`} aria-label="Faixa de uso" id="ub-body">
      {open ? (
        <div className="ub-anim" key="open">
          <div className={`ub-grid n${meters.length}`}>
            {meters.map((m) => (
              <div key={m.key} className={`ub-tile${m.stale ? ' stale' : ''}`}>
                <Ring m={m} size={36} />
                <div className="ub-txt"><b>{m.label}</b><span>{m.sub}</span></div>
              </div>
            ))}
          </div>
          <div className="ub-foot"><span>{foot}</span>{arrow}</div>
        </div>
      ) : (
        <div className="ub-anim ub-row" key="closed" title={foot}>
          <div className={`ub-cols n${meters.length}`}>
            {meters.map((m) => (
              <div key={m.key} className={`ub-col${m.stale ? ' stale' : ''}`}>
                <Ring m={m} size={40} />
                <span className="ub-lbl">{m.label}</span>
              </div>
            ))}
          </div>
          {arrow}
        </div>
      )}
    </section>
  )
}
