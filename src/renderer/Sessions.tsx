import { Copy, Eye, Pin, Terminal, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { STATE_LABEL } from '../shared/machine'
import type { AppSnapshot, Session } from '../shared/types'
import { ConfirmButton, IconButton, StateChip, Toggle } from './ui'
import './sessions.css'

export function ago(ts: number) {
  if (!ts) return 'sem eventos'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  return s < 60 ? `${s}s atrás` : s < 3600 ? `${Math.round(s / 60)} min atrás` : `${Math.round(s / 3600)} h atrás`
}

export function Sessions({ snap }: { snap: AppSnapshot }) {
  const [proj, setProj] = useState('')
  const [hideEnded, setHideEnded] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 5000); return () => clearInterval(t) }, [])
  // o filtro só oferece projetos com sessão visível (antes: projeto só com encerradas + "ocultar encerradas" = lista vazia)
  const visible = snap.sessions.filter((s) => !hideEnded || s.liveness !== 'ended')
  const counts = new Map<string, number>()
  visible.forEach((s) => counts.set(s.project, (counts.get(s.project) ?? 0) + 1))
  const p = counts.has(proj) ? proj : ''
  const list = visible
    .filter((s) => !p || s.project === p)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastEventAt - a.lastEventAt)
  const ended = snap.sessions.filter((s) => s.liveness === 'ended' && (!p || s.project === p)).map((s) => s.id)
  return (
    <>
      <div className="sx-bar">
        <select className="ui-select" value={p} onChange={(e) => setProj(e.target.value)} aria-label="Filtrar por projeto">
          <option value="">Todos os projetos ({visible.length})</option>{[...counts].map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
        </select>
        <label className="sx-hide"><Toggle checked={hideEnded} onChange={setHideEnded} label="Ocultar encerradas" /><span>ocultar encerradas</span></label>
      </div>
      {ended.length > 0 && (
        <div className="sx-clean">
          <ConfirmButton sm label={`Excluir encerradas${p ? ` de ${p}` : ''} (${ended.length})`} confirmLabel={`Excluir ${ended.length} do pet?`} onConfirm={() => window.pet.forgetSessions(ended)} />
          <small>Some só do pet; o histórico do Claude Code fica.</small>
        </div>
      )}
      <div className="sx-list thin-scroll">
        {!snap.hooks.installed && <div className="sx-warn">Hooks não instalados: só vemos sessões abertas, sem estado em tempo real. Instale em Configurações &gt; Claude Code.</div>}
        {!list.length && <div className="sx-empty">Nenhuma sessão {hideEnded ? 'ativa ' : ''}encontrada.</div>}
        {list.map((s) => <SessionCard key={s.id} s={s} watched={snap.settings.watchedSessionId === s.id} open={open === s.id} onOpen={() => setOpen(open === s.id ? null : s.id)} />)}
      </div>
    </>
  )
}

const ORIGIN = { cli: 'CLI', desktop: 'Desktop', chat: 'Mini chat', unknown: 'origem ?' }
const LIVE = { active: 'ativa', unknown: 'desconhecida', ended: 'encerrada' }

function SessionCard({ s, watched, open, onOpen }: { s: Session; watched: boolean; open: boolean; onOpen: () => void }) {
  return (
    <div className={`sx-card ui-card ${watched ? 'watched' : ''}`} onContextMenu={(e) => { e.preventDefault(); window.pet.contextMenu({ kind: 'session', id: s.id }) }}>
      <button type="button" className="sx-head" onClick={onOpen} aria-expanded={open}>
        <b className="sx-name">{s.pinned && <Pin size={12} aria-label="fixada" />} {s.project}</b>
        <StateChip state={s.state}>{STATE_LABEL[s.state]}</StateChip>
      </button>
      <div className="sx-path" title={s.cwd}>{s.cwd}</div>
      <div className="sx-meta">
        <span>{LIVE[s.liveness]} · {ORIGIN[s.origin]}{s.subagents ? ` · ${s.subagents} subagente(s)` : ''}</span>
        <span>{ago(s.lastEventAt)}</span>
      </div>
      {s.tool && <div className="sx-tool"><Wrench size={12} /> {s.tool}</div>}
      {s.note && <div className="sx-note">{s.note}</div>}
      <div className="sx-actions">
        <IconButton sm label={watched ? 'Observando (clique para soltar)' : 'Observar esta sessão'} accent={watched} onClick={() => window.pet.watchSession(watched ? null : s.id)}><Eye size={13} /></IconButton>
        <IconButton sm label={s.pinned ? 'Desafixar' : 'Fixar'} accent={s.pinned} onClick={() => window.pet.pinSession(s.id, !s.pinned)}><Pin size={13} /></IconButton>
        <IconButton sm label={s.liveness === 'active' ? 'Em uso em outro terminal' : 'Retomar (claude --resume)'} disabled={s.liveness === 'active'} onClick={() => window.pet.openClaude({ session: s.id })}><Terminal size={13} /></IconButton>
        <IconButton sm label="Copiar ID da sessão" onClick={() => window.pet.copy(s.id)}><Copy size={13} /></IconButton>
      </div>
      {open && (
        <div className="sx-log">
          {[...s.log].reverse().slice(0, 12).map((l, i) => <div key={i}>{new Date(l.ts).toLocaleTimeString()} {l.event}{l.tool ? ` (${l.tool})` : ''}</div>)}
          {!s.log.length && 'Sem eventos recebidos.'}
        </div>
      )}
    </div>
  )
}
