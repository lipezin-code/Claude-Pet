import { ChevronDown, Copy, Maximize2, FolderOpen, Minus, Monitor, Play, Plus, Send, Settings as Cog, Square, Terminal, Eye, Users, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { STATE_LABEL, projectName } from '../shared/machine'
import type { AppSnapshot, ChatConversation } from '../shared/types'
import { CopyButton, Md } from './Markdown'
import { PetSprite } from './Pet'
import { Sessions } from './Sessions'
import { ConfirmButton, IconButton, Segmented, StateChip } from './ui'
import { UsageBand } from './UsageBand'
import './chat.css'

export function Chat({ snap, initialTab = 'chat' }: { snap: AppSnapshot; initialTab?: 'chat' | 'sessions' }) {
  const [tab, setTab] = useState<'chat' | 'sessions'>(initialTab)
  const [convs, setConvs] = useState<ChatConversation[]>([])
  const [cur, setCur] = useState<string | null>(null)
  const [live, setLive] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [menu, setMenu] = useState(false)
  const [convMenu, setConvMenu] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const curRef = useRef(cur); curRef.current = cur

  const reload = useCallback(async (select?: string) => {
    const l = await window.pet.conversations(); setConvs(l)
    setCur((c) => select ?? (c && l.some((x) => x.id === c) ? c : l[0]?.id ?? null))
    return l
  }, [])

  useEffect(() => {
    reload().then(async (l) => { if (!l.length) { const c = await window.pet.newConversation(null); reload(c.id) } })
    const a = window.pet.onChat((e) => {
      if (e.convId !== curRef.current) return
      if (e.type === 'delta') setLive((t) => t + e.text)
    })
    return a
  }, [reload])

  const conv = convs.find((c) => c.id === cur)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [conv?.messages.length, live, pending, tab])
  useEffect(() => { // textarea cresce até 110px
    const t = taRef.current; if (!t) return
    t.style.height = 'auto'; t.style.height = `${Math.min(110, t.scrollHeight)}px`
  }, [input])


  const newConv = async () => {
    const c = await window.pet.newConversation(null); setLive(''); await reload(c.id); setTab('chat'); return c
  }
  /** Depois de excluir: se a atual sumiu, reload escolhe a 1ª; sem nenhuma, cria uma vazia. */
  const afterDelete = async () => { setLive(''); const l = await reload(); if (!l.length) { const c = await window.pet.newConversation(null); await reload(c.id) } }

  const send = async () => {
    const t = input.trim()
    if (!t || !cur || busy) return
    setInput(''); setBusy(true); setLive(''); setPending(t)
    try { await window.pet.send(cur, t) } catch (e) { alert(String(e)) }
    setBusy(false); setPending(null); setLive(''); await reload()
  }
  const openRef = conv ? { conv: conv.id } : undefined
  const disp = snap.display
  const dsess = snap.sessions.find((s) => s.id === disp.sessionId)
  const sid = conv?.claudeSessionId ?? snap.sessions.find((s) => s.id === disp.sessionId)?.id
  const pct = Math.round(snap.settings.scale * 100)
  const liveCount = snap.sessions.filter((s) => s.liveness !== 'ended').length

  return (
    <div className="cx" onClick={() => { if (menu) setMenu(false); if (convMenu) setConvMenu(false) }}>
      <header className="cx-hdr">
        <div className="cx-avatar" aria-hidden>
          <PetSprite state="IDLE" skin={snap.skin} busyTool={false} hover={false} dragging={false} animate={false} />
        </div>
        <div className="cx-title">
          <b>Claude</b>
          <div className="cx-sub">
            <StateChip state={disp.state}>{STATE_LABEL[disp.state]}</StateChip>
            {dsess && <span className="cx-proj" title={dsess.cwd}>{dsess.project}</span>}
          </div>
        </div>
        <div className="cx-actions">
          <IconButton accent label="Abrir Claude Code (escolher pasta)" onClick={() => window.pet.openClaude({ pick: true })}><Terminal size={15} /></IconButton>
          <IconButton label="Mais opções" aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu) }}><ChevronDown size={15} /></IconButton>
          <IconButton label="Equipes" onClick={() => window.pet.openView('teams')}><Users size={15} /></IconButton>
          <IconButton label="Configurações" onClick={() => window.pet.openView('settings')}><Cog size={15} /></IconButton>
          <IconButton label="Minimizar" onClick={() => window.pet.hideChat()}><Minus size={15} /></IconButton>
        </div>
      </header>

      {menu && (
        <div className="cx-menu ui-card" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="cx-size" role="group" aria-label="Tamanho do pet">
            <Maximize2 size={14} /><span>Tamanho do pet</span>
            <IconButton sm label="Diminuir pet" disabled={pct <= 50} onClick={() => window.pet.setSettings({ scale: (pct - 10) / 100 })}><Minus size={13} /></IconButton>
            <b>{pct}%</b>
            <IconButton sm label="Aumentar pet" disabled={pct >= 200} onClick={() => window.pet.setSettings({ scale: (pct + 10) / 100 })}><Plus size={13} /></IconButton>
          </div>
          <hr />
          <button role="menuitem" onClick={() => { window.pet.openClaude(openRef); setMenu(false) }}><Play size={14} /> Abrir nova sessão</button>
          <button role="menuitem" disabled={!conv?.claudeSessionId} onClick={() => { if (conv) window.pet.openClaude({ conv: conv.id, resume: true }); setMenu(false) }}><Terminal size={14} /> Retomar conversa do chat</button>
          <button role="menuitem" onClick={() => { setTab('sessions'); setMenu(false) }}><Eye size={14} /> Retomar sessão (aba Sessões)</button>
          <hr />
          <button role="menuitem" disabled={!conv?.cwd} onClick={() => { if (conv) window.pet.openFolder({ conv: conv.id }); setMenu(false) }}><FolderOpen size={14} /> Abrir pasta do projeto</button>
          <button role="menuitem" onClick={async () => { const r = await window.pet.openDesktop(); if (!r.ok) alert(r.error); setMenu(false) }}><Monitor size={14} /> Abrir Claude Desktop</button>
          <button role="menuitem" disabled={!sid} onClick={() => { window.pet.copy(sid!); setMenu(false) }}><Copy size={14} /> Copiar ID da sessão</button>
        </div>
      )}

      <div className="cx-tabs">
        <Segmented value={tab} onChange={setTab} options={[{ id: 'chat', label: 'Chat' }, { id: 'sessions', label: `Sessões · ${liveCount}` }]} />
      </div>

      {snap.settings.showUsageBand && <UsageBand snap={snap} />}

      {tab === 'sessions' ? <Sessions snap={snap} /> : (
        <>
          <div className="cx-bar">
            {/* listas próprias em vez de <select>: o dropdown nativo não aceita botão direito nas opções */}
            <button type="button" className="ui-select cx-pick cx-conv" title={conv?.title ?? 'Conversas'} aria-label="Conversas" aria-haspopup="dialog" aria-expanded={convMenu}
              onClick={(e) => { e.stopPropagation(); setConvMenu(!convMenu) }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setConvMenu(true) }}>
              {conv?.title ?? 'Conversas'}
            </button>
            <IconButton sm label="Nova conversa" onClick={() => newConv()}><Plus size={14} /></IconButton>

          {convMenu && (
            <div className="cx-menu cx-pjmenu ui-card" role="dialog" aria-label="Gerenciar conversas" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setConvMenu(false)}>
              <ul className="pj-list" aria-label="Conversas">
                {convs.map((c) => (
                  <li key={c.id} className={`pj-item ${c.id === cur ? 'on' : ''}`} onContextMenu={async (e) => { e.preventDefault(); if (await window.pet.contextMenu({ kind: 'conv', id: c.id }) === 'deleted') afterDelete() }}>
                    <button type="button" className="pj-txt pj-pick" title={c.cwd} aria-current={c.id === cur} onClick={() => { setCur(c.id); setLive(''); setConvMenu(false) }}>
                      <b>{c.title}</b><small>{c.cwd ? projectName(c.cwd) + ' · ' : ''}{new Date(c.updatedAt).toLocaleString()} · {c.messages.length} msg</small>
                    </button>
                    <ConfirmButton sm icon label={`Excluir “${c.title}”`} confirmLabel="Excluir?" disabled={busy && c.id === cur} onConfirm={() => window.pet.deleteConversations([c.id]).then(afterDelete)}><X size={13} /></ConfirmButton>
                  </li>
                ))}
              </ul>
              <hr />
              <ConfirmButton sm label={`Excluir todas menos a atual (${convs.length - 1})`} confirmLabel={`Excluir ${convs.length - 1} conversas?`} disabled={convs.length < 2}
                onConfirm={() => window.pet.deleteConversations(convs.filter((c) => c.id !== cur).map((c) => c.id)).then(afterDelete)} />
              <small className="pj-note">Clique para abrir · botão direito ou “x” para excluir. Some só do pet; o Claude Code guarda o histórico dele à parte.</small>
            </div>
          )}
          </div>

          <div className="cx-msgs thin-scroll">
            {!conv?.messages.length && !pending && (
              <div className="cx-empty">
                <div className="cx-empty-pet"><PetSprite state="IDLE" skin={snap.skin} busyTool={false} hover={false} dragging={false} animate={false} /></div>
                <b>Converse com o Claude</b>
                <span>Tire dúvidas rápidas, sem acesso a arquivos</span>
                <span>Sessões do terminal ficam na aba Sessões</span>
                <i className="cx-model">{snap.settings.chatModel || 'sonnet'}</i>
              </div>
            )}
            {conv?.messages.map((m) => (
              <div key={m.id} className={`cx-msg ${m.role}`}>
                {m.role === 'assistant'
                  ? <><Md text={m.text} /><div className="cx-msgtools"><CopyButton text={m.text} className="ui-ibtn sm" /></div></>
                  : m.text}
              </div>
            ))}
            {pending && <div className="cx-msg user">{pending}</div>}
            {busy && (live
              ? <div className="cx-msg assistant"><Md text={live} /></div>
              : <div className="cx-dots" aria-label="Processando"><span /><span /><span /></div>)}
            <div ref={endRef} />
          </div>

          <div className="cx-compose">
            <textarea ref={taRef} rows={1} value={input} placeholder="Mensagem para o Claude…" aria-label="Mensagem"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            {busy
              ? <IconButton label="Parar" onClick={() => cur && window.pet.stop(cur)}><Square size={14} /></IconButton>
              : <IconButton accent label="Enviar" onClick={send} disabled={!input.trim()}><Send size={15} /></IconButton>}
          </div>
        </>
      )}
    </div>
  )
}
