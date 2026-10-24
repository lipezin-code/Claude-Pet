import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Send, Users } from 'lucide-react'
import { IconButton } from './ui'
import { DEFAULT_SETTINGS, type AppSnapshot, type ChatConversation, type Session } from '../shared/types'
import { PREVIEW_SKINS } from './previewSkins'
import { Chat } from './Chat'
import { ContextMenu } from './ContextMenu'
import { Settings } from './Settings'
import { serializeMenu } from '../main/menuModel'

// QA visual das janelas (rota #preview-ui, ?w=chat|sessions|settings&tab=...&theme=light). Mock de window.pet: nada de IPC real.
const now = Date.now()
const mk = (id: string, project: string, state: Session['state'], extra: Partial<Session> = {}): Session => ({
  id, cwd: `C:\\Users\\usuario\\Documents\\Projetos\\${project}`, project, state, stateSince: now, lastEventAt: now - 12_000, origin: 'cli', liveness: 'active',
  pinned: false, subagents: 0, log: [{ ts: now - 20_000, event: 'UserPromptSubmit' }, { ts: now - 12_000, event: 'PreToolUse', tool: 'Bash' }], ...extra
})
const SESSIONS: Session[] = [
  mk('a1b2c3d4-1111', 'claude-pet', 'WORKING', { tool: 'Bash', pinned: true }),
  mk('e5f6a7b8-2222', 'nihon-sushi-delivery', 'WAITING_PERMISSION', { tool: 'Edit', lastEventAt: now - 95_000 }),
  mk('c9d0e1f2-3333', 'presentes-da-pry', 'COMPLETED', { lastEventAt: now - 300_000 }),
  mk('01234567-4444', 'acai-club', 'UNKNOWN', { lastEventAt: 0, note: 'Aguardando eventos', origin: 'unknown' }),
  mk('89abcdef-5555', 'old-project', 'DISCONNECTED', { liveness: 'ended' })
]
const CONV: ChatConversation = {
  id: 'c1', title: 'Refatorar o hook', cwd: SESSIONS[0].cwd, updatedAt: now,
  messages: [
    { id: 'm1', role: 'user', text: 'Explique o que o hook faz e mostre um exemplo.', ts: now },
    { id: 'm2', role: 'assistant', ts: now, text: 'O hook **nunca bloqueia** o Claude Code e envia só campos permitidos:\n\n- tipo do evento\n- ID da sessão\n- nome da ferramenta\n\n```ts\nconst ev = { session_id, hook_event_name, tool_name }\nawait post(ev)\n```\n\nVeja `claude-pet-hook.cjs` para detalhes.' },
    { id: 'm3', role: 'error', text: 'Erro de autenticação. Verifique a chave de API.', ts: now }
  ]
}

// faixa de uso (?usage=full|hot|norl|stale|none&band=open)
function mockUsage(kind: string | null): AppSnapshot['usage'] {
  const sec = Math.floor(now / 1000)
  const at = kind === 'stale' ? now - 9 * 60_000 : now - 4_000
  if (kind === 'none') return { account: null, sessions: {} }
  const hot = kind === 'hot'
  return {
    account: kind === 'norl' ? null : { five: { pct: hot ? 96 : 41, resetsAt: sec + 2 * 3600 }, week: { pct: hot ? 83 : 22, resetsAt: sec + 4 * 86_400 }, updatedAt: at },
    sessions: { [SESSIONS[0].id]: { ctx: { pct: hot ? 88 : 21, size: 1_000_000, tokens: hot ? 880_000 : 212_000 }, totals: { read: 2_140_000, creation: 180_000, input: 1200 }, updatedAt: at } }
  }
}

function snap(theme: 'dark' | 'light', display: AppSnapshot['display']): AppSnapshot {
  const q = new URLSearchParams(location.search)
  return {
    settings: { ...DEFAULT_SETTINGS, theme, usageBandExpanded: q.get('band') === 'open' }, skin: PREVIEW_SKINS[0], sessions: SESSIONS, display,
    hooks: { installed: true, events: Array(14).fill('x'), settingsPath: 'C:\\Users\\usuario\\.claude\\settings.json', port: 50196 },
    usage: mockUsage(q.get('usage')), statusBridge: q.get('usage') === 'none' ? 'not_installed' : 'installed',
    cli: { found: true, path: 'C:\\Users\\usuario\\.local\\bin\\claude.exe', version: '2.1.308 (Claude Code)' }, version: '1.1.0',
    projects: [
      { id: 'a1b2c3d4e5f6', name: 'claude-pet', path: 'C:\\Users\\usuario\\Documents\\Projetos\\claude-pet', group: 'pinned' },
      { id: 'b1b2c3d4e5f6', name: 'site-loja', path: 'C:\\Users\\usuario\\Documents\\Projetos\\clientes\\site-loja', group: 'recent' }
    ],
    envMarkers: q.get('env') === 'dirty' ? ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION'] : [], teams: [], agentTeams: [], manualProject: null
  }
}

// ?w=buttons: cada variante em cada estado. Hover/clique/foco são forçados clonando as regras :hover/:active/:focus-visible em classes.
const STATES = ['normal', 'hover', 'clique', 'foco', 'desabilitado'] as const
const stateCls = { normal: '', hover: 'is-hover', clique: 'is-hover is-active', foco: 'is-focus', desabilitado: '' }
function ButtonSheet() {
  useEffect(() => {
    const out: string[] = []
    for (const sh of Array.from(document.styleSheets)) {
      let rules: CSSRuleList; try { rules = sh.cssRules } catch { continue }
      for (const r of Array.from(rules)) if (r instanceof CSSStyleRule && /:hover|:active|:focus-visible/.test(r.selectorText))
        out.push(r.cssText.replace(r.selectorText, r.selectorText.replace(/:hover/g, '.is-hover').replace(/:active/g, '.is-active').replace(/:focus-visible/g, '.is-focus')))
    }
    const st = document.createElement('style'); st.textContent = out.join('\n'); document.head.appendChild(st)
    return () => st.remove()
  }, [])
  const rows: [string, (c: string, d: boolean) => ReactNode][] = [
    ['Ícone', (c, d) => <IconButton label="x" className={`ui-ibtn ${c}`} disabled={d}><Users size={15} /></IconButton>],
    ['Ícone acento', (c, d) => <IconButton accent label="x" className={`ui-ibtn accent ${c}`} disabled={d}><Send size={15} /></IconButton>],
    ['Ícone pequeno', (c, d) => <IconButton sm label="x" className={`ui-ibtn sm ${c}`} disabled={d}><Plus size={14} /></IconButton>],
    ['Botão', (c, d) => <button type="button" className={`ui-btn ${c}`} disabled={d}>Testar</button>],
    ['Botão primário', (c, d) => <button type="button" className={`ui-btn primary ${c}`} disabled={d}>Instalar hooks</button>],
    ['Botão perigo', (c, d) => <button type="button" className={`ui-btn danger ${c}`} disabled={d}>Excluir?</button>],
    ['Seletor', (c, d) => <button type="button" className={`ui-select cx-pick ${c}`} style={{ width: 120 }} disabled={d}>Nova conversa</button>],
    ['Abas', (c, d) => <div className="ui-seg" style={{ width: 170 }}><button type="button" aria-selected="true" disabled={d}>Chat</button><button type="button" className={c} disabled={d}>Sessões</button></div>]
  ]
  return (
    <div style={{ padding: 20, background: 'var(--bg-1)', color: 'var(--text)', minHeight: '100vh' }}>
      <table style={{ borderSpacing: '18px 14px' }}>
        <thead><tr><th />{STATES.map((s) => <th key={s} style={{ color: 'var(--text-mute)', fontWeight: 500, fontSize: 11 }}>{s}</th>)}</tr></thead>
        <tbody>{rows.map(([name, r]) => <tr key={name}><td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{name}</td>{STATES.map((s) => <td key={s}>{r(stateCls[s], s === 'desabilitado')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function PreviewUI() {
  const q = new URLSearchParams(location.search)
  const theme = (q.get('theme') === 'light' ? 'light' : 'dark') as 'dark' | 'light'
  const w = q.get('w') ?? 'chat'
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const noop = () => {}
    const conv = q.has('empty') ? { ...CONV, title: 'Nova conversa', messages: [] } : CONV // ?empty = conversa recém-criada
    ;(window as any).pet = new Proxy({
      snapshot: async () => snap(theme, { state: 'WORKING', sessionId: SESSIONS[0].id, label: 'claude-pet: Trabalhando' }),
      onSnapshot: () => noop, listSkins: async () => PREVIEW_SKINS, conversations: async () => [conv], newConversation: async () => conv, onChat: () => noop,
      menuModel: async () => serializeMenu([
        { label: 'Claude Pet', enabled: false }, { label: 'Estado: claude-pet: Trabalhando', enabled: false }, { type: 'separator' },
        { label: 'Abrir mini chat', click: () => {} }, { label: 'Equipes', click: () => {} }, { label: 'Sessões ativas (3)', submenu: [{ label: 'Automático (política)', type: 'radio', checked: true, click: () => {} }, { label: 'claude-pet — Trabalhando', type: 'radio', click: () => {} }] },
        { label: 'Abrir Claude Code', click: () => {} }, { label: 'Selecionar projeto', submenu: [] }, { type: 'separator' }, { label: 'Alterar mascote', submenu: [] }, { label: 'Tamanho do pet', submenu: [] },
        { label: 'Sempre visível', type: 'checkbox', checked: true, click: () => {} }, { type: 'separator' }, { label: 'Sons e notificações', submenu: [] }, { label: 'Iniciar com Windows', type: 'checkbox', checked: false, click: () => {} },
        { type: 'separator' }, { label: 'Configurações', click: () => {} }, { label: 'Ocultar pet (bandeja)', click: () => {} }, { label: 'Sobre', click: () => {} }, { type: 'separator' }, { label: 'Sair', click: () => {} }
      ], new Map()),
      previewHooks: async () => ({ settingsPath: 'C:\\Users\\usuario\\.claude\\settings.json', exists: true, changes: 6, token: '0'.repeat(64),
        diff: '…\n      }\n    ],\n+   "TeammateIdle": [\n+     {\n+       "hooks": [\n+         { "type": "command", "command": "node", "args": ["…\\\\claude-pet-hook.cjs"], "async": true, "timeout": 5 }\n+       ]\n+     }\n+   ],\n    "TaskCreated": [\n…' }),
      hasApiKey: async () => false, pinProject: async () => {}, removeProject: async () => {}, pickProject: async () => null, diagnostics: async () => ({ logs: ['2026-10-22T12:17:12Z evento UserPromptSubmit baa9b219', '2026-10-22T12:17:16Z evento PreToolUse baa9b219 Read'], server: { received: 42, rejected: 0 }, lastEvent: { event: 'PreToolUse', sessionId: 'baa9b219', at: now } })
    }, { get: (t: any, k: string) => t[k] ?? noop })
    document.documentElement.dataset.theme = theme
    document.documentElement.toggleAttribute('data-still', q.has('still')) // ?still = "Reduzir movimento" ligado
    document.documentElement.dataset.view = w === 'settings' ? 'settings' : 'chat'
    setReady(true)
  }, [theme, w])
  if (!ready) return null
  if (w === 'buttons') return <ButtonSheet />
  if (w === 'menu') return <div style={{ width: 256, background: '#3a3d46' }}><ContextMenu /></div>
  const s = snap(theme, { state: 'WORKING', sessionId: SESSIONS[0].id, label: 'claude-pet: Trabalhando' })
  if (w === 'settings') return <div style={{ width: 760, height: 560 }}><Settings snap={s} /></div>
  return (
    <div style={{ width: 380, height: 480, background: '#3a3d46', padding: 0 }}>
      <Chat snap={s} initialTab={w === 'sessions' ? 'sessions' : 'chat'} />
    </div>
  )
}
