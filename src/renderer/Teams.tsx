import { Check, CircleHelp, Copy, Crown, FolderOpen, Pencil, Plus, RefreshCw, Send, SquareTerminal, Terminal, Unlink, Users, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { STATE_LABEL } from '../shared/machine'
import type { Skin } from '../shared/skins'
import { LAPTOP_PAD } from '../shared/sprites'
import {
  AGENT_MASCOT, agentStatus, buildRoster, doneKey, isActive, KIND_LABEL, KINDS, LABEL_MAX, MAX_AGENTS, newTeam, resolveAgent, slotSkins,
  slugify, statusLabel, subCount, TEAM_NAME, TEMPLATES, type AgentStatus, type Kind, type RosterRow, type Slot, type Team, type TeamAgent
} from '../shared/teams'
import type { ManualProject, PetState, Session } from '../shared/types'
import { adjustmentsPrompt, deliveryMessage, leaderInstruction, taskPrompt, teamFlow } from '../shared/manualFlow'
import { memberNames, memberSkins, memberStatus, teamEnded, UNKNOWN, type AgentTeam, type AgentTeamMember } from '../shared/agentTeams'
import { PetSprite, useHidden } from './Pet'
import { ago } from './Sessions'
import { T } from './mascot/timings'
import { useMascotVisual } from './mascot/useMascotVisual'
import { Button, ConfirmButton, IconButton, Segmented, StateChip } from './ui'
import './teams.css'

/** Ações da janela. No app vão por IPC (window.pet); no preview, para um estado local. */
export interface TeamApi {
  bind: (slot: Slot, sessionId: string | null) => void
  roster?: (rows: RosterRow[]) => void
  manual?: ManualApi
  set: (p: { name?: string; goal?: string }) => void
  removeAgentTeams?: (ids: string[]) => void
  openTeam?: () => void
  resume?: (sessionId: string) => void
  copy?: (text: string) => void
}

/** Equipe manual: preparação do projeto. Tudo validado e executado no main. */
export interface ManualApi {
  pick: () => Promise<boolean>
  preview: (which: 'claude' | 'gitignore') => Promise<{ path: string; exists: boolean; diff: string; changes: number; token: string }>
  apply: (which: 'claude' | 'gitignore', token: string) => Promise<boolean>
  copyWorktrees: () => Promise<string>
  open: (slot: Slot) => Promise<{ ok: boolean; error?: string }>
}

/** Janela focada? Sem foco ou minimizada, os mini mascotes congelam (CPU ~0 com a janela em segundo plano). */
function useFocused() {
  const [f, setF] = useState(document.hasFocus())
  useEffect(() => {
    const on = () => setF(true), off = () => setF(false)
    window.addEventListener('focus', on); window.addEventListener('blur', off)
    return () => { window.removeEventListener('focus', on); window.removeEventListener('blur', off) }
  }, [])
  return f
}

// cor do chip: parou de responder é alerta (vermelho), validada/concluída verde, sem sessão cinza
const CHIP: Record<AgentStatus, PetState> = {
  working: 'WORKING', waiting: 'UNKNOWN', needs_you: 'WAITING_PERMISSION', done: 'COMPLETED',
  stalled: 'ERROR', validated: 'COMPLETED', ended: 'DISCONNECTED', unbound: 'DISCONNECTED', unknown: 'UNKNOWN',
  delivered: 'WAITING_PERMISSION', // âmbar: espera você levar ao líder
  changes: 'ERROR', approved: 'COMPLETED', validating: 'WORKING', ready: 'WAITING_PERMISSION', integrated: 'COMPLETED'
}

/** Monitor: equipe manual (sessões vinculadas por função) + Agent Teams detectadas em ~/.claude/teams. */
export function Teams({ teams, agentTeams = [], manualProject = null, sessions, skins, teamSkins, animate, api, onSimulate }: {
  teams: Team[]; agentTeams?: AgentTeam[]; manualProject?: ManualProject | null; sessions: Session[]; skins: Skin[]; teamSkins: Partial<Record<Slot, string>>; animate: boolean; api: TeamApi; onSimulate?: () => void
}) {
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 5000); return () => clearInterval(t) }, [])
  const hidden = useHidden(), focused = useFocused()
  const paused = hidden || !focused
  const team = teams[0] ?? newTeam() // 1B: uma equipe (salva no 1º vínculo/edição)
  const ids = skins.map((s) => s.id)
  const given = slotSkins(teamSkins, ids)
  const byId = new Map(skins.map((s) => [s.id, s]))
  const owner = new Map(team.agents.flatMap((a) => (a.sessionId ? [[a.sessionId, a] as const] : [])))
  const flow = teamFlow(team.agents, (a) => resolveAgent(a, sessions).st, manualProject?.deliveries ?? {}, manualProject?.verdicts ?? {})
  const rows = team.agents.map((a) => ({ a, s: resolveAgent(a, sessions).s, st: flow.get(a.id)! }))
  const live = sessions.filter((s) => s.liveness !== 'ended').sort((a, b) => b.lastEventAt - a.lastEventAt)
  const leadOf = (t: AgentTeam) => sessions.find((s) => s.id === t.leadSessionId)
  const ats = [...agentTeams].sort((a, b) => Number(teamEnded(a, leadOf(a))) - Number(teamEnded(b, leadOf(b))) || b.seenAt - a.seenAt)
  const endedIds = ats.filter((t) => teamEnded(t, leadOf(t))).map((t) => t.id)
  const manualActive = rows.filter((r) => isActive(r.st)).length
  const teamActive = ats.reduce((n, t) => n + t.members.filter((m) => isActive(memberStatus(t, m, leadOf(t)))).length, 0)
  const leadSkin = given.get('lider') ?? ''
  const [tab, setTab] = useState<'agent' | 'manual'>('agent')
  const [editing, setEditing] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [help, setHelp] = useState(false)
  const active = tab === 'agent' ? teamActive : manualActive

  return (
    <div className={`tm ${paused ? 'paused' : ''}`} style={{ ['--type-ms' as string]: `${T.typeFrameMs}ms`, ['--glyph-ms' as string]: `${T.glyphMs}ms`, ['--move-ms' as string]: `${T.laptopMoveMs}ms` }}>
      <div className="tm-tabs">
        <Segmented value={tab} onChange={setTab} options={[
          { id: 'agent', label: `Agent Teams${teamActive ? ` (${teamActive})` : ''}` },
          { id: 'manual', label: `Equipe manual${manualActive ? ` (${manualActive})` : ''}` }
        ]} />
        <IconButton sm label="Como funciona" accent={help} onClick={() => setHelp(!help)}><CircleHelp size={14} /></IconButton>
        {onSimulate && <span className="tm-demo" title="Preview: dados fictícios">dados fictícios</span>}
        {onSimulate && <IconButton label="Simular mudança de estado" onClick={onSimulate}><RefreshCw size={15} /></IconButton>}
      </div>
      {tab === 'agent' ? (
        <>
          <header className="tm-hdr">
            <Users size={18} />
            <div className="tm-title">
              <b className="tm-h">Agent Teams</b>
              <span className="tm-goal">O líder cria os membros e os cards aparecem sozinhos</span>
            </div>
            {api.openTeam && <Button sm primary onClick={api.openTeam} title="Pede a pasta e abre o Claude Code com Agent Teams ligado só nessa janela">
              <SquareTerminal size={14} /> Abrir Claude em modo equipe</Button>}
            <span className="tm-count">{active} {active === 1 ? 'agente ativo' : 'agentes ativos'}</span>
          </header>
          <div className="tm-scroll thin-scroll">
            {help && <HelpPanel onClose={() => setHelp(false)} />}
            {endedIds.length > 1 && api.removeAgentTeams && (
              <div className="tm-clean">
                <ConfirmButton sm label={`Limpar encerradas (${endedIds.length})`} confirmLabel={`Remover ${endedIds.length} do pet?`} onConfirm={() => api.removeAgentTeams!(endedIds)} />
                <small>Some só do pet. A pasta do Claude Code fica intacta</small>
              </div>
            )}
            {ats.map((t) => (
              <AgentTeamSection key={t.id} t={t} lead={leadOf(t)} skins={byId} skinIds={ids} leadSkin={leadSkin} animate={animate} paused={paused}
                onRemove={api.removeAgentTeams && (() => api.removeAgentTeams!([t.id]))} />
            ))}
            {!ats.length && (
              <div className="tm-empty">
                <b>Nenhuma equipe ainda</b>
                <span>Clique em Abrir Claude em modo equipe e peça ao Claude uma equipe</span>
                <span>Os membros aparecem aqui sozinhos</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <header className="tm-hdr">
            <Users size={18} />
            <div className="tm-title">
              <TextField className="tm-tname" value={team.name} label="Nome da equipe (letras, números e hífen)" valid={(v) => TEAM_NAME.test(v)} onSave={(name) => api.set({ name })} />
              <TextField className="tm-goal" value={team.goal} label="Objetivo da equipe" placeholder="Objetivo da equipe" max={300} onSave={(goal) => api.set({ goal })} />
            </div>
            {manualProject && <span className="tm-proj" title={manualProject.path}>{manualProject.name} ({manualProject.branch ?? 'sem branch'})</span>}
            {api.manual && !preparing && <Button sm onClick={() => setPreparing(true)}><Wrench size={13} /> Preparar projeto</Button>}
            {api.roster && !editing && <Button sm onClick={() => setEditing(true)}><Pencil size={13} /> Editar equipe</Button>}
            <span className="tm-count">{active} {active === 1 ? 'agente ativo' : 'agentes ativos'}</span>
          </header>
          <div className="tm-scroll thin-scroll">
            {help && <HelpPanel onClose={() => setHelp(false)} />}
            {preparing && api.manual && <PreparePanel info={manualProject} team={team} m={api.manual} onClose={() => setPreparing(false)} />}
            {editing && api.roster
              ? <RosterEditor team={team} onCancel={() => setEditing(false)} onSave={(r) => { api.roster!(r); setEditing(false) }} />
              : <p className="tm-hint">Abra uma sessão do Claude Code por função em terminais separados e vincule cada uma no seu card</p>}
            <div className="tm-grid">
              {rows.map(({ a, s, st }) => (
                <AgentCard key={a.id} a={a} s={s} st={st} skin={byId.get(given.get(a.id) ?? '') ?? skins[0]} animate={animate} paused={paused}
                  live={live} owner={owner} api={api} project={manualProject} team={team.agents} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Casco visual comum: mini mascote + título + estado + tarefa + meta. Todo texto é renderizado como texto (React). */
function CardShell({ st, label, title, lead, skin, tool, completionKey, animate, paused, task, meta, children }: {
  st: AgentStatus; label: string; title: React.ReactNode; lead?: boolean; skin: Skin; tool?: string; completionKey: string | null
  animate: boolean; paused: boolean; task: React.ReactNode; meta: React.ReactNode; children?: React.ReactNode
}) {
  // líder não coda: revisando = olhar concentrado (THINKING) e nunca pega o notebook
  const mode = lead && st === 'working' ? 'THINKING' : AGENT_MASCOT[st]
  const vis = useMascotVisual({ mode, completionKey, animate, paused })
  const u = 4 // px por "pixel" do sprite
  return (
    <article className={`tm-card ui-card st-${st} ${lead ? 'lead' : ''}`}>
      <div className={`tm-pet ${st === 'unbound' ? 'off' : ''}`} style={{ width: (16 + LAPTOP_PAD) * u, height: 20 * u, paddingLeft: LAPTOP_PAD * u }} aria-hidden>
        <PetSprite state={vis.state} skin={skin} busyTool={!lead && !!tool} hover={false} dragging={false}
          animate={animate && !paused} gaze={vis.gaze} laptop={lead ? 'none' : vis.laptop} glyph={vis.glyph} glyphN={vis.glyphN} />
      </div>
      <div className="tm-body">
        <div className="tm-head">
          <b className="tm-name">{lead && <Crown size={14} aria-hidden />}{title}</b>
          <StateChip state={CHIP[st]}>{st === 'validated' && <Check size={11} aria-hidden />} {label}</StateChip>
        </div>
        {task}
        <div className="tm-meta">{meta}</div>
        {children}
      </div>
    </article>
  )
}

function AgentCard({ a, s, st, skin, animate, paused, live, owner, api, project, team }: {
  a: TeamAgent; s?: Session; st: AgentStatus; skin: Skin; animate: boolean; paused: boolean
  live: Session[]; owner: Map<string, TeamAgent>; api: TeamApi; project: ManualProject | null; team: TeamAgent[]
}) {
  const lead = a.id === 'lider'
  const task = project?.tasks[a.id]
  const del = project?.deliveries[a.id]
  const ver = project?.verdicts[a.id]
  // abrir terminal: líder na pasta do projeto; agente só se o worktree dele já existir
  const canOpen = !!project && (lead || !!project.worktrees[a.id]?.ready)
  const openTip = !project ? 'Escolha a pasta em Preparar projeto'
    : canOpen ? `Abrir Claude Code em ${lead ? project.path : project.worktrees[a.id]?.path}` : 'O worktree ainda não existe. Crie em Preparar projeto'
  return (
    <CardShell st={st} label={statusLabel(lead, st)} title={a.label} lead={lead} skin={skin} tool={s?.tool}
      completionKey={(st === 'delivered' || st === 'approved') && del ? `${st}:${del.hash}` : st === 'done' && s ? doneKey(s) : null} animate={animate} paused={paused}
      task={lead
        ? <div className="tm-task tm-ro">Coordena e revisa, não programa</div>
        : task ? <div className="tm-tasktxt" title={task}>{task}</div>
        : <div className="tm-task tm-ro">Sem tarefa ainda <code>.equipe/tarefas/{a.slug}.md</code></div>}
      meta={<>
        <span>{s ? `última atividade ${ago(s.lastEventAt)}${s.tool ? `, usando ${s.tool}` : ''}` : 'nenhuma sessão vinculada'}</span>
        <SubCounter s={s} />
        {del && <span className="tm-del" title={`${del.subject} (${del.stat})`}>{del.hash.slice(0, 8)} · {del.subject.replace(/^ENTREGA:\s*/, '')}</span>}
        {s && <span className="tm-term" title={a.worktree?.path ?? s.cwd}><Terminal size={12} /> {s.project} · {s.id.slice(0, 8)}</span>}
      </>}>
      <div className="tm-actions">
        <select className="ui-select tm-bind" aria-label={`Sessão de ${a.label}`} value={a.sessionId ?? ''}
          onChange={(e) => api.bind(a.id, e.target.value || null)}>
          <option value="">{a.sessionId ? 'Soltar sessão' : 'Vincular sessão'}</option>
          {a.sessionId && !live.some((x) => x.id === a.sessionId) && <option value={a.sessionId}>{s ? `${s.project} (encerrada)` : 'sessão removida'}</option>}
          {live.map((x) => {
            const o = owner.get(x.id)
            const other = o && o.id !== a.id
            return <option key={x.id} value={x.id} disabled={!!other}>{x.project} · {STATE_LABEL[x.state]} · {x.id.slice(0, 8)}{other ? ` (${o.label})` : ''}</option>
          })}
        </select>
        {a.sessionId && <IconButton sm label="Soltar sessão" onClick={() => api.bind(a.id, null)}><Unlink size={13} /></IconButton>}
        {api.manual && <IconButton sm accent={canOpen} disabled={!canOpen} label={openTip} onClick={() => { void api.manual!.open(a.id).catch((e) => alert(String(e?.message ?? e))) }}><SquareTerminal size={13} /></IconButton>}
        {s && api.resume && <IconButton sm disabled={s.liveness === 'active'} label={s.liveness === 'active' ? 'Em uso em outro terminal' : 'Retomar (claude --resume)'} onClick={() => api.resume!(s.id)}><Terminal size={13} /></IconButton>}
        {s && api.copy && <IconButton sm label="Copiar ID da sessão" onClick={() => api.copy!(s.id)}><Copy size={13} /></IconButton>}
      </div>
      {api.copy && ((lead && project?.branch) || (!lead && (task || del || (st === 'changes' && ver)))) && (
        <div className="tm-flow">
          {lead && project?.branch && <Button sm onClick={() => api.copy!(leaderInstruction(team, project.branch!))}><Copy size={13} /> Copiar instrução do líder</Button>}
          {!lead && task && <Button sm onClick={() => api.copy!(taskPrompt(a, task))}><Copy size={13} /> Copiar tarefa</Button>}
          {!lead && del && project?.branch && <Button sm primary={st === 'delivered'} onClick={() => api.copy!(deliveryMessage(a, del, project.branch!))}><Send size={13} /> Enviar ao líder</Button>}
          {!lead && st === 'changes' && ver && <Button sm primary onClick={() => api.copy!(adjustmentsPrompt(a, ver))}><Copy size={13} /> Copiar ajustes</Button>}
        </div>
      )}
    </CardShell>
  )
}

/**
 * Montar/editar a equipe: Líder fixo + 1 a 7 agentes. Função da lista ou Personalizada; o nome é livre e o
 * identificador (slug) sai dele. A validação é a MESMA do main (buildRoster), então o "Salvar" só liga se passar lá.
 */
function RosterEditor({ team, onSave, onCancel }: { team: Team; onSave: (rows: RosterRow[]) => void; onCancel: () => void }) {
  const [rows, setRows] = useState<RosterRow[]>(() => team.agents.filter((a) => a.id !== 'lider').map((a) => ({ id: a.id as RosterRow['id'], kind: a.kind as Kind, label: a.label })))
  const r = buildRoster(rows)
  const setRow = (i: number, p: Partial<RosterRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <section className="tm-roster ui-card">
      <div className="tm-rhead">
        <b>Montar equipe</b>
        <span className="tm-muted">Modelos rápidos</span>
        {TEMPLATES.map((t) => (
          <Button key={t.id} sm onClick={() => setRows(t.kinds.map((k, i) => ({ id: rows[i]?.id, kind: k, label: KIND_LABEL[k] })))}>{t.label}</Button>
        ))}
      </div>
      <p className="tm-hint">O Líder é fixo. De 1 a {MAX_AGENTS} agentes. O identificador vira o nome da branch, da pasta e do arquivo, e a cor do card não muda ao trocar a função.</p>
      {rows.map((x, i) => (
        <div className="tm-rrow" key={x.id ?? `novo-${i}`}>
          <select className="ui-select" aria-label="Função" value={x.kind}
            onChange={(e) => { const k = e.target.value as Kind; setRow(i, { kind: k, label: k === 'custom' ? '' : KIND_LABEL[k] }) }}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="ui-input" aria-label="Nome de exibição" placeholder="Nome da função" maxLength={LABEL_MAX} value={x.label}
            onChange={(e) => setRow(i, { label: e.target.value })} />
          <code className={`tm-slug ${!r.ok && r.row === i ? 'bad' : ''}`} title="Identificador usado na branch, na pasta e no arquivo">{slugify(x.label) || '—'}</code>
          <IconButton sm label="Remover agente" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={13} /></IconButton>
        </div>
      ))}
      <div className="tm-actions">
        <Button sm disabled={rows.length >= MAX_AGENTS} onClick={() => setRows([...rows, { kind: 'custom', label: '' }])}><Plus size={13} /> Adicionar agente</Button>
        <span className="tm-err" role="status">{!r.ok ? r.error : ''}</span>
        <Button sm primary disabled={!r.ok} onClick={() => onSave(rows)}>Salvar</Button>
        <Button sm onClick={onCancel}>Cancelar</Button>
      </div>
    </section>
  )
}

type EditPreview = { path: string; exists: boolean; diff: string; changes: number; token: string }

/** Preparar projeto: pasta do líder, regras no CLAUDE.md, .equipe/ no .gitignore e comandos de worktree (só copiados). */
function PreparePanel({ info, team, m, onClose }: { info: ManualProject | null; team: Team; m: ManualApi; onClose: () => void }) {
  const [pv, setPv] = useState<{ which: 'claude' | 'gitignore'; p: EditPreview } | null>(null)
  const [cmds, setCmds] = useState('')
  const [msg, setMsg] = useState('')
  const run = async (f: () => Promise<void>) => { setMsg(''); try { await f() } catch (e) { setMsg('Erro: ' + String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } }
  const agents = team.agents.filter((a) => a.id !== 'lider')
  const ready = agents.filter((a) => info?.worktrees[a.id]?.ready).length
  const branch = info?.branch ?? '(branch não detectada)'
  return (
    <section className="tm-roster ui-card">
      <div className="tm-rhead">
        <b>Preparar projeto</b>
        <Button sm onClick={() => run(async () => { await m.pick() })}><FolderOpen size={13} /> {info ? 'Trocar pasta' : 'Escolher pasta do projeto'}</Button>
        <span className="tm-grow" />
        <IconButton sm label="Fechar" onClick={onClose}><X size={13} /></IconButton>
      </div>
      {!info ? <p className="tm-hint">Escolha a pasta principal do projeto (onde o líder vai trabalhar).</p> : <>
        <p className="tm-hint">Pasta do líder <code title={info.path}>{info.name}</code> na branch <code>{branch}</code></p>
        <PrepStep ok={info.claudeMd === 'ok'} title="Regras da equipe no CLAUDE.md"
          detail={info.claudeMd === 'ok' ? 'Seção "# Regras da equipe" presente' : info.claudeMd === 'missing' ? 'CLAUDE.md não existe' : 'CLAUDE.md sem a seção da equipe'}
          action={info.claudeMd === 'ok' ? undefined : info.claudeMd === 'missing' ? 'Criar CLAUDE.md' : 'Adicionar seção'}
          onAction={() => run(async () => setPv({ which: 'claude', p: await m.preview('claude') }))} />
        <PrepStep ok={info.gitignore === 'ok'} title=".equipe/ no .gitignore" detail={info.gitignore === 'ok' ? 'Já ignorado' : 'Tarefas e revisões ficam fora do git'}
          action={info.gitignore === 'ok' ? undefined : 'Adicionar'} onAction={() => run(async () => setPv({ which: 'gitignore', p: await m.preview('gitignore') }))} />
        {pv && (
          <div className="tm-diffbox">
            <p className="tm-hint">{pv.p.exists ? 'Diferença em' : 'Arquivo novo'} <code>{pv.p.path}</code>. Nada é apagado e só grava quando você confirmar.</p>
            {pv.p.changes ? <pre className="tm-diff thin-scroll">{pv.p.diff.split(/\r?\n/).map((l, i) => <span key={i} className={l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : ''}>{l}{'\n'}</span>)}</pre>
              : <p className="tm-hint">Nada a mudar.</p>}
            <div className="tm-actions">
              <Button sm primary disabled={!pv.p.changes} onClick={() => run(async () => { await m.apply(pv.which, pv.p.token); setPv(null); setMsg(`Gravado. Faça commit na ${branch} antes de criar os worktrees.`) })}>Confirmar e gravar</Button>
              <Button sm onClick={() => setPv(null)}>Cancelar</Button>
            </div>
          </div>
        )}
        <p className="tm-hint">Faça commit do CLAUDE.md e do .gitignore na <code>{branch}</code> antes de criar os worktrees, porque cada worktree nasce do último commit.</p>
        <PrepStep ok={ready === agents.length} title="Worktrees dos agentes" detail={`${ready} de ${agents.length} prontos`}
          action="Copiar comandos de worktree" onAction={() => run(async () => setCmds(await m.copyWorktrees()))} />
        {cmds && <>
          <pre className="tm-diff thin-scroll">{cmds}</pre>
          <p className="tm-hint">Copiado. Cole no PowerShell e rode você mesmo, o pet não executa comandos.</p>
        </>}
      </>}
      {msg && <p className="tm-msg">{msg}</p>}
    </section>
  )
}

function PrepStep({ ok, title, detail, action, onAction }: { ok: boolean; title: string; detail: string; action?: string; onAction: () => void }) {
  return (
    <div className={`tm-step ${ok ? 'ok' : ''}`}>
      <span className="tm-stepdot" aria-hidden>{ok ? <Check size={12} /> : null}</span>
      <div className="tm-steptxt"><b>{title}</b><span>{detail}</span></div>
      {action && <Button sm onClick={onAction}>{action}</Button>}
    </div>
  )
}

/** "Como funciona" da equipe manual: texto fixo, escrito aqui (nada vem da internet). */
function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="tm-roster ui-card tm-help">
      <div className="tm-rhead"><b>Como funciona a equipe manual</b><span className="tm-grow" /><IconButton sm label="Fechar" onClick={onClose}><X size={13} /></IconButton></div>
      <p>Cada agente é uma sessão do Claude Code no seu terminal. <b>Os agentes não conversam entre si</b>: você leva as mensagens de um para outro com os botões de copiar e cola no terminal certo. O pet nunca digita nada nos terminais.</p>
      <h4>Passo a passo</h4>
      <ol>
        <li><b>Preparar projeto</b>: escolha a pasta, adicione as regras ao CLAUDE.md e .equipe/ ao .gitignore, e faça commit.</li>
        <li><b>Montar equipe</b>: escolha as funções (ou um modelo rápido). O identificador de cada uma vira o nome da branch.</li>
        <li><b>Abrir terminais</b>: copie os comandos de worktree, rode no PowerShell e use o botão de terminal de cada card.</li>
        <li><b>Delegar</b>: cole a instrução do líder. Ele escreve uma tarefa por agente em .equipe/tarefas e você usa Copiar tarefa em cada card.</li>
        <li><b>Trabalho e entrega</b>: cada agente trabalha no próprio worktree e termina com um commit "ENTREGA: ...". O card avisa e você usa Enviar ao líder.</li>
        <li><b>Revisão</b>: o líder revisa o diff e grava "aprovado &lt;hash&gt;" ou "ajustes &lt;hash&gt;: ..." em .equipe/revisoes. Se ele pedir ajustes, use Copiar ajustes para levar ao agente.</li>
        <li><b>Integração</b>: com todos aprovados, o líder mostra Pronto para integrar. O merge só acontece depois que você confirmar para o líder.</li>
      </ol>
      <h4>Como cada um sabe o que o outro fez</h4>
      <ul>
        <li>O contrato (rotas, campos, formatos) vai escrito na tarefa de cada lado.</li>
        <li>Cada agente pode ver o trabalho do outro com git log / git diff na branch dele.</li>
        <li>O líder revisa o diff de cada entrega, não só o resumo.</li>
        <li>O Git não deixa a mesma branch aberta em dois worktrees, o que reforça que só o líder mexe na branch principal.</li>
      </ul>
      <h4>Qual aba usar</h4>
      <ul>
        <li><b>Agent Teams</b>: os membros conversam sozinhos dentro de uma sessão. É mais rápido, com menos controle.</li>
        <li><b>Equipe manual</b>: controle total de cada passagem. Bom para projetos sensíveis como checkout e pagamento.</li>
      </ul>
      <h4>Cuidados</h4>
      <ul>
        <li>Não coloque nada sensível no CLAUDE.md, porque ele vai para o git.</li>
        <li>Confira o texto antes de colar em um terminal.</li>
        <li>Mantenha as confirmações de permissão do Claude Code ligadas.</li>
      </ul>
      <p className="tm-hint">Com 2 ou 3 agentes é tranquilo. Com mais, cada passagem exige um clique e um colar.</p>
    </section>
  )
}

/** Agent Team detectada: líder (sessão) + 1 card por membro, skins sem repetir. Só leitura: sem ações. */
function AgentTeamSection({ t, lead, skins, skinIds, leadSkin, animate, paused, onRemove }: {
  t: AgentTeam; lead?: Session; skins: Map<string, Skin>; skinIds: string[]; leadSkin: string; animate: boolean; paused: boolean; onRemove?: () => void
}) {
  const ended = teamEnded(t, lead)
  const sk = memberSkins(t, skinIds, leadSkin)
  const pick = (id?: string) => skins.get(id ?? '') ?? [...skins.values()][0]
  const lst: AgentStatus = ended ? 'ended' : agentStatus(lead, false)
  return (
    <section className="tm-at">
      <h3 className="tm-sec">
        Agent Team em {lead?.project ?? UNKNOWN}{ended && <span className="tm-ended">encerrada</span>}
        {onRemove && <ConfirmButton sm label={ended ? 'Remover' : 'Remover do pet'} confirmLabel="Remover do pet?" onConfirm={onRemove} />}
      </h3>
      <div className="tm-grid">
        <CardShell st={lst} label={statusLabel(true, lst)} title="Líder" lead skin={pick(leadSkin)} tool={lead?.tool}
          completionKey={lst === 'done' && lead ? doneKey(lead) : null} animate={animate} paused={paused}
          task={<div className="tm-task tm-ro">{t.members.length} {t.members.length === 1 ? 'membro' : 'membros'} na equipe</div>}
          meta={<>
            <span>{lead ? `última atividade ${ago(lead.lastEventAt)}` : 'sessão do líder desconhecida'}</span>
            <SubCounter s={lead} skip={memberNames(t)} />
            {lead && <span className="tm-term" title={lead.cwd}><Terminal size={12} /> {lead.project} · {lead.id.slice(0, 8)}</span>}
          </>} />
        {t.members.map((m) => <MemberCard key={m.name} t={t} m={m} lead={lead} skin={pick(sk.get(m.name))} animate={animate} paused={paused} />)}
      </div>
    </section>
  )
}

function MemberCard({ t, m, lead, skin, animate, paused }: { t: AgentTeam; m: AgentTeamMember; lead?: Session; skin: Skin; animate: boolean; paused: boolean }) {
  const st = memberStatus(t, m, lead)
  const sub = (lead?.subs ?? []).filter((x) => x.type === m.name).sort((a, b) => b.lastEventAt - a.lastEventAt)[0]
  const task = lead?.teamTasks?.[m.name]
  return (
    <CardShell st={st} label={statusLabel(false, st)} title={m.name} skin={skin} tool={st === 'unknown' ? undefined : sub?.tool}
      completionKey={st === 'done' && sub ? `${t.id}:${m.name}:${sub.lastEventAt}` : null} animate={animate} paused={paused}
      task={<div className="tm-task tm-ro" title={task?.subject}>{task?.subject ?? 'tarefa desconhecida'}</div>}
      meta={<>
        <span>{st === 'unknown' ? 'nome igual a um tipo de subagente, estado não confiável' : sub ? `última atividade ${ago(sub.lastEventAt)}${sub.tool ? `, usando ${sub.tool}` : ''}` : 'sem atividade ainda'}</span>
        <span className="tm-term" title={`tipo: ${m.agentType}`}>membro: {m.name}</span>
      </>} />
  )
}

/** Subagentes não são membros: só um contador no card de quem os chamou. */
export function SubCounter({ s, skip }: { s?: Session; skip?: ReadonlySet<string> }) {
  const n = subCount(s, skip)
  if (!n.total) return null
  return <span className="tm-subs" title="Subagentes chamados por esta sessão">{n.total} {n.total === 1 ? 'subagente' : 'subagentes'}{n.active ? `, ${n.active} ativo${n.active > 1 ? 's' : ''}` : ''}</span>
}

/** Texto editável no lugar: salva ao sair do campo ou Enter; Esc desfaz. Valor inválido não é enviado. */
function TextField({ value, onSave, label, placeholder, className, max = 40, valid = () => true }: {
  value: string; onSave: (v: string) => void; label: string; placeholder?: string; className?: string; max?: number; valid?: (v: string) => boolean
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const ok = valid(v.trim())
  const commit = () => { const t = v.trim(); if (t !== value && ok) onSave(t); else if (!ok) setV(value) }
  return (
    <input className={`tm-input ${className ?? ''} ${ok ? '' : 'bad'}`} value={v} maxLength={max} aria-label={label} title={label} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur() } }} />
  )
}
