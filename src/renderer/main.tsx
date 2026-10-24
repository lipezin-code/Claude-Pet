import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppSnapshot } from '../shared/types'
import { Chat } from './Chat'
import { ContextMenu } from './ContextMenu'
import { Pet } from './Pet'
import { Preview, PreviewSkins } from './Preview'
import { PreviewUI } from './PreviewUI'
import { Settings } from './Settings'
import { Teams, type TeamApi } from './Teams'
import { demoAgentTeam, demoSessions, demoTeam } from './teamsDemo'
import { buildRoster, type Team } from '../shared/teams'
import { PREVIEW_SKINS } from './previewSkins'
import type { Skin } from '../shared/skins'
import '@fontsource-variable/inter/index.css'
import './tokens.css'
import './ui/ui.css'
import './styles.css'

declare global { interface Window { pet: import('../preload').PetApi } }

function useSnapshot() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  useEffect(() => { window.pet.snapshot().then(setSnap); return window.pet.onSnapshot(setSnap) }, [])
  return snap
}

function TeamsView({ snap }: { snap: AppSnapshot }) {
  const [skins, setSkins] = useState<Skin[] | null>(null)
  useEffect(() => { window.pet.listSkins().then(setSkins) }, [])
  const api: TeamApi = {
    manual: { pick: () => window.pet.manualPick(), preview: (w) => window.pet.manualPreview(w), apply: (w, t) => window.pet.manualApply(w, t),
      copyWorktrees: () => window.pet.manualCopyWorktrees(), open: (slot) => window.pet.manualOpen(slot) },
    bind: (r, id) => window.pet.teamBind(r, id), roster: (rows) => { window.pet.teamRoster(rows).catch((e) => alert(String(e?.message ?? e))) },
    set: (p) => window.pet.teamSet(p), removeAgentTeams: (ids) => window.pet.removeAgentTeams(ids), openTeam: () => { window.pet.openClaudeTeam() }, resume: (id) => window.pet.openClaude({ session: id }), copy: (t) => window.pet.copy(t)
  }
  return skins && <Teams teams={snap.teams} agentTeams={snap.agentTeams} manualProject={snap.manualProject} sessions={snap.sessions} skins={skins} teamSkins={snap.settings.teamSkins ?? {}} animate={snap.settings.animations && !snap.settings.reduceMotion} api={api} />
}

/** #preview-teams: mesma tela com equipe/sessões fictícias em estado local (sem IPC). "Simular" gira os estados entre os agentes. */
function PreviewTeams() {
  const [team, setTeam] = useState<Team>(demoTeam)
  const [ses, setSes] = useState(demoSessions)
  const agent = (r: string, f: (a: Team['agents'][number]) => Team['agents'][number]) => setTeam((t) => ({ ...t, agents: t.agents.map((a) => (a.id === r ? f(a) : a)) }))
  const api: TeamApi = {
    bind: (r, id) => agent(r, (a) => ({ ...a, sessionId: id ?? undefined })), set: (p) => setTeam((t) => ({ ...t, ...p })), openTeam: () => {}, copy: () => {},
    manual: { pick: async () => true, apply: async () => true, open: async () => ({ ok: true }),
      preview: async (w) => ({ path: 'C:/Projetos/loja-checkout/' + (w === 'claude' ? 'CLAUDE.md' : '.gitignore'), exists: true, changes: 2, token: '0'.repeat(64),
        diff: w === 'claude' ? '  # Loja\n+ \n+ # Regras da equipe\n+ - Agentes: nunca trabalhem na main nem façam merge.' : '  node_modules\n+ .equipe/' }),
      copyWorktrees: async () => "Set-Location -LiteralPath 'C:/Projetos/loja-checkout'\ngit worktree add ..\\loja-checkout-back-end -b back-end" },
    roster: (rows) => { const r = buildRoster(rows); if (r.ok) setTeam((t) => ({ ...t, agents: r.agents.map((a) => ({ ...a, sessionId: t.agents.find((x) => x.id === a.id)?.sessionId })) })) }
  }
  const simulate = () => setSes((l) => { const now = Date.now(); return l.map((s, i) => ({ ...l[(i + 1) % l.length], id: s.id, stateSince: now, lastEventAt: now })) })
  const mp = { path: 'C:/Projetos/loja-checkout', name: 'loja-checkout', branch: 'main', claudeMd: 'no-rules' as const, gitignore: 'ok' as const,
    worktrees: { a1: { path: 'C:/Projetos/loja-checkout-back-end', ready: true }, a2: { path: 'C:/Projetos/loja-checkout-front-end', ready: false } },
    deliveries: { a1: { hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', at: Date.now(), subject: 'ENTREGA: rota de pedidos + testes', stat: '3 files changed, 120 insertions(+)', merged: false, hasBase: true } },
    verdicts: { a1: { kind: 'changes' as const, hash: 'a1b2c3d4e5f6', notes: 'Validar qtd > 0 e responder 400 com mensagem.' } },
    tasks: { a1: 'Criar POST /api/pedidos com validação.\nArquivos: server/**.\nContrato: { itens: [{ id, qtd }] } -> 201 { id }.' } }
  return <Teams teams={[team]} agentTeams={[demoAgentTeam()]} manualProject={mp} sessions={ses} skins={PREVIEW_SKINS} teamSkins={{}} animate api={api} onSimulate={simulate} />
}

function App() {
  const snap = useSnapshot()
  const view = location.hash.slice(1) || 'pet'
  useEffect(() => { if (snap) document.documentElement.dataset.theme = snap.settings.theme }, [snap?.settings.theme])
  useEffect(() => { document.documentElement.toggleAttribute('data-still', !!snap?.settings.reduceMotion) }, [snap?.settings.reduceMotion])
  if (!snap) return null
  return view === 'menu' ? <ContextMenu /> : view === 'chat' ? <Chat snap={snap} /> : view === 'settings' ? <Settings snap={snap} /> : view === 'teams' ? <TeamsView snap={snap} /> : <Pet snap={snap} />
}

document.documentElement.dataset.view = location.hash.slice(1) || 'pet'
// #preview: QA visual do mascote, sem IPC (abrir no navegador via `npm run preview:ui`)
const hash = location.hash.slice(1)
createRoot(document.getElementById('root')!).render(<StrictMode>{hash === 'preview' ? <Preview /> : hash === 'preview-skins' ? <PreviewSkins /> : hash === 'preview-ui' ? <PreviewUI /> : hash === 'preview-teams' ? <PreviewTeams /> : <App />}</StrictMode>)
