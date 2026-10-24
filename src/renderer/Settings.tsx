import { Bell, Bot, Brush, MousePointerClick, Stethoscope, Terminal, Wind, Moon, Volume2, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Skin } from '../shared/skins'
import { SLOT_LABEL, SLOTS, slotSkins, swapSkin } from '../shared/teams'
import type { AppSnapshot, Settings as S } from '../shared/types'
import { PetSprite } from './Pet'
import { ProjectManager, ProjectOptions, sameDir } from './ProjectSelect'
import { Button, ConfirmButton, Segmented, Slider, Tile, Toggle } from './ui'
import './settings.css'

const TABS = [
  { id: 'Aparência', icon: Brush }, { id: 'Comportamento', icon: MousePointerClick }, { id: 'Claude Code', icon: Terminal },
  { id: 'Chat', icon: Bot }, { id: 'Notificações', icon: Bell }, { id: 'Diagnóstico', icon: Stethoscope }
] as const
type Tab = (typeof TABS)[number]['id']

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="st-row"><div className="st-lbl">{label}{hint && <small>{hint}</small>}</div><div className="st-ctl">{children}</div></div>
}
const Card = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <section className="st-card ui-card">{title && <h3>{title}</h3>}{children}</section>
)

export function Settings({ snap }: { snap: AppSnapshot }) {
  const [tab, setTab] = useState<Tab>('Aparência')
  const [skins, setSkins] = useState<Skin[]>([])
  useEffect(() => { window.pet.listSkins().then(setSkins) }, [])
  const s = snap.settings
  const set = (p: Partial<S>) => window.pet.setSettings(p)
  const Sw = ({ k, label }: { k: keyof S; label: string }) => <Toggle label={label} checked={s[k] as boolean} onChange={(v) => set({ [k]: v })} />

  return (
    <div className="st">
      <nav className="st-side">
        <div className="st-brand"><div className="st-logo"><PetSprite state="IDLE" skin={snap.skin} busyTool={false} hover={false} dragging={false} animate={false} /></div><b>Claude Pet</b></div>
        {TABS.map(({ id, icon: Icon }) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)} aria-current={tab === id}><Icon size={16} />{id}</button>
        ))}
        <div className="st-ver">v{snap.version}</div>
      </nav>

      <main className="st-pane thin-scroll">
        <h2>{tab}</h2>

        {tab === 'Aparência' && <>
          <div className="st-tiles">
            <Tile icon={<Wind size={18} />} label="Animações" value={s.animations ? 'Ligadas' : 'Desligadas'} on={s.animations} right={<Sw k="animations" label="Animações" />} />
            <Tile icon={<Moon size={18} />} label="Reduzir movimento" value={s.reduceMotion ? 'Ligado' : 'Desligado'} on={s.reduceMotion} right={<Sw k="reduceMotion" label="Reduzir movimento" />} />
            <Tile icon={<Zap size={18} />} label="Sempre visível" value={s.alwaysOnTop ? 'Ligado' : 'Desligado'} on={s.alwaysOnTop} right={<Sw k="alwaysOnTop" label="Sempre visível" />} />
          </div>
          <Card title="Mascote">
            <SkinPicker skins={skins} active={s.skinId} animate={s.animations && !s.reduceMotion} />
          </Card>
          <Card title="Skins das equipes">
            <TeamSkins skins={skins} saved={s.teamSkins ?? {}} />
          </Card>
          <Card>
            <SliderField label="Tamanho do pet" value={Math.round(s.scale * 100)} min={50} max={200} step={10} onCommit={(v) => set({ scale: v / 100 })} />
            <div className="st-gap" />
            <SliderField label="Opacidade do pet" value={Math.round(s.opacity * 100)} min={30} max={100} step={5} onCommit={(v) => set({ opacity: v / 100 })} />
          </Card>
          <Card>
            <Row label="Tema"><Segmented value={s.theme} onChange={(v) => set({ theme: v })} options={[{ id: 'dark', label: 'Escuro' }, { id: 'light', label: 'Claro' }]} /></Row>
          </Card>
          <p className="st-note">Skins de terceiros: ainda não suportado (skins do app em <code>skins/&lt;id&gt;/skin.json</code>, ver README). Tempos das animações: <code>src/renderer/mascot/timings.ts</code>.</p>
        </>}

        {tab === 'Comportamento' && <Card>
          <Row label="Iniciar com o Windows" hint="Funciona no app instalado."><Sw k="autostart" label="Iniciar com o Windows" /></Row>
          <Row label="Duplo clique no pet">
            <Segmented value={s.doubleClick} onChange={(v) => set({ doubleClick: v })} options={[{ id: 'claude', label: 'Claude Code' }, { id: 'chat', label: 'Chat' }, { id: 'none', label: 'Nada' }]} />
          </Row>
          <Row label="Política com várias sessões" hint="Atenção: permissão > erro > ativa > concluída. Recente: a última com atividade.">
            <Segmented value={s.policy} onChange={(v) => set({ policy: v })} options={[{ id: 'attention', label: 'Atenção' }, { id: 'recent', label: 'Recente' }]} />
          </Row>
          <Row label="Sessão observada" hint="Vence a política enquanto estiver selecionada.">
            <select className="ui-select" value={s.watchedSessionId ?? ''} onChange={(e) => set({ watchedSessionId: e.target.value || null })}>
              <option value="">Automático</option>
              {snap.sessions.filter((x) => x.liveness !== 'ended').map((x) => <option key={x.id} value={x.id}>{x.project} ({x.id.slice(0, 8)})</option>)}
            </select>
          </Row>
          <p className="st-note">Ocultar em jogos/tela cheia: não implementado (o Windows não expõe isso de forma confiável).</p>
        </Card>}

        {tab === 'Claude Code' && <ClaudeTab snap={snap} />}

        {tab === 'Chat' && <>
          <div className="st-warn">
            <b>Autenticação e custos.</b> O motor <b>CLI</b> usa o <code>claude</code> instalado com o seu login (assinatura ou chave), sem o Claude Pet tocar em credenciais.
            O motor <b>Agent SDK</b> exige uma <b>chave de API</b> (cobrança por uso, separada da assinatura): a Anthropic não permite que apps de terceiros usem login claude.ai.
            Nos dois motores o mini chat é só conversa (igual ao Claude Desktop): sem ferramentas, não lê, edita nem apaga arquivos e não roda comandos.
          </div>
          <Card>
            <Row label="Motor"><Segmented value={s.chatEngine} onChange={(v) => set({ chatEngine: v })} options={[{ id: 'cli', label: 'CLI (seu login)' }, { id: 'sdk', label: 'SDK (chave API)' }]} /></Row>
            <ApiKey />
            <Row label="Modelo" hint="Vazio = sonnet. Ex.: sonnet, opus, haiku."><input className="ui-input" type="text" value={s.chatModel} onChange={(e) => set({ chatModel: e.target.value })} /></Row>
          </Card>
          <p className="st-note">Histórico das conversas: <code>%APPDATA%\ClaudePet\conversations.json</code> (somente local).</p>
        </>}

        {tab === 'Notificações' && <>
          <div className="st-tiles">
            <Tile icon={<Bell size={18} />} label="Notificações" value={s.notifications ? 'Ligadas' : 'Desligadas'} on={s.notifications} right={<Sw k="notifications" label="Notificações do Windows" />} />
            <Tile icon={<Volume2 size={18} />} label="Sons" value={s.sounds ? 'Ligados' : 'Desligados'} on={s.sounds} right={<Sw k="sounds" label="Sons" />} />
            <Tile icon={<Moon size={18} />} label="Modo silencioso" value={s.silent ? 'Ligado' : 'Desligado'} on={s.silent} right={<Sw k="silent" label="Modo silencioso" />} />
          </div>
          <Card>
            <Row label="Somente eventos importantes" hint="Permissão, erro e tarefas longas."><Sw k="onlyImportant" label="Somente eventos importantes" /></Row>
            <Row label="Tarefa longa a partir de (s)"><input className="ui-input st-num" type="text" value={s.longTaskSeconds} onChange={(e) => { const n = +e.target.value; if (n >= 5) set({ longTaskSeconds: n }) }} /></Row>
            <SliderField label="Volume" value={Math.round(s.volume * 100)} min={0} max={100} step={5} onCommit={(v) => set({ volume: v / 100 })} />
          </Card>
        </>}

        {tab === 'Diagnóstico' && <Diag snap={snap} />}
      </main>
    </div>
  )
}

/** Galeria de skins: grupo de rádio (setas/Home/End movem e aplicam; Tab entra só no card ativo). Clique aplica e salva. */
function SkinPicker({ skins, active, animate }: { skins: Skin[]; active: string; animate: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const cur = Math.max(0, skins.findIndex((k) => k.id === active))
  const pick = (i: number) => { const n = (i + skins.length) % skins.length; window.pet.setSkin(skins[n].id); refs.current[n]?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    const d = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (d) pick(cur + d); else if (e.key === 'Home') pick(0); else if (e.key === 'End') pick(skins.length - 1); else return
    e.preventDefault()
  }
  return (
    <div className={`st-skins ${animate ? '' : 'still'}`} role="radiogroup" aria-label="Mascote" onKeyDown={onKey}>
      {skins.map((k, i) => (
        <button key={k.id} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={k.id === active} tabIndex={i === cur ? 0 : -1}
          className={`st-mcard ${k.id === active ? 'on' : ''}`} onClick={() => window.pet.setSkin(k.id)}>
          <span className="pv"><PetSprite state="IDLE" skin={k} busyTool={false} hover={false} dragging={false} animate={animate} /></span>
          <span className="nm">{k.name}</span>
          <span className="sw" aria-hidden="true">{k.swatches.map((c, j) => <i key={j} style={{ background: c }} />)}</span>
        </button>
      ))}
    </div>
  )
}

/** Skin de cada posição de card na janela Equipes (a função do card pode mudar; a cor fica). Sem repetir: escolher a skin de outra posição troca as duas. */
function TeamSkins({ skins, saved }: { skins: Skin[]; saved: S['teamSkins'] }) {
  const ids = skins.map((k) => k.id)
  const cur = slotSkins(saved, ids)
  const byId = new Map(skins.map((k) => [k.id, k]))
  return (
    <div className="st-team">
      {SLOTS.map((r) => {
        const skin = byId.get(cur.get(r) ?? '')
        return (
          <div key={r} className="st-trow">
            <span className="pv">{skin && <PetSprite state="IDLE" skin={skin} busyTool={false} hover={false} dragging={false} animate={false} />}</span>
            <b>{SLOT_LABEL[r]}</b>
            <div className="sw" role="radiogroup" aria-label={`Skin de ${SLOT_LABEL[r]}`}>
              {skins.map((k) => {
                const other = SLOTS.find((o) => o !== r && cur.get(o) === k.id)
                return (
                  <button key={k.id} type="button" role="radio" aria-checked={k.id === skin?.id} className={k.id === skin?.id ? 'on' : ''}
                    title={other ? `${k.name} (troca com ${SLOT_LABEL[other]})` : k.name}
                    onClick={() => window.pet.setSettings({ teamSkins: swapSkin(saved, r, k.id, ids) })}
                    style={{ background: `linear-gradient(135deg, ${k.swatches[0]} 50%, ${k.swatches[1]} 50%)` }}>
                    {other && <i aria-hidden />}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <small className="st-muted">O mascote principal continua com a skin escolhida acima.</small>
    </div>
  )
}

/** Número grande + slider; o número acompanha o dedo na hora, o app recebe 1x por frame. */
function SliderField({ label, value, min, max, step, onCommit }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [live, setLive] = useState(value)
  useEffect(() => setLive(value), [value])
  return <>
    <div className="st-big"><span className="n">{live}</span><span className="u">%</span><span className="l">{label}</span></div>
    <Slider label={label} value={value} min={min} max={max} step={step} onChange={onCommit} onLive={setLive} minLabel={`${min}%`} maxLabel={`${max}%`} />
  </>
}

function ApiKey() {
  const [has, setHas] = useState(false)
  const [v, setV] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { window.pet.hasApiKey().then(setHas) }, [])
  return (
    <Row label="Chave de API (SDK)" hint="Guardada criptografada (DPAPI/safeStorage). Nunca aparece em logs.">
      <div className="st-inline">
        <input className="ui-input" type="password" placeholder={has ? '•••••••• (salva)' : 'sk-ant-…'} value={v} onChange={(e) => setV(e.target.value)} />
        <Button sm disabled={!v} onClick={async () => { const ok = await window.pet.setApiKey(v); setMsg(ok ? 'Salva' : 'Criptografia indisponível'); setHas(ok); setV('') }}>Salvar</Button>
        {has && <Button sm onClick={async () => { await window.pet.setApiKey(''); setHas(false); setMsg('Removida') }}>Remover</Button>}
        <span className="st-muted">{msg}</span>
      </div>
    </Row>
  )
}

type HooksPreview = Awaited<ReturnType<typeof window.pet.previewHooks>>

/** Prévia do merge no settings.json: mostra a diferença (texto puro) e só grava com "Confirmar". */
function HooksDiff({ p, onConfirm, onCancel }: { p: HooksPreview; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="st-diffbox">
      <p className="st-muted">Arquivo: {p.settingsPath}{p.exists ? ' · backup antes de gravar em ~/.claude/backups' : ' · será criado'}. Hooks de terceiros não são alterados.</p>
      {p.changes
        ? <pre className="st-diff thin-scroll">{p.diff.split(/\r?\n/).map((l, i) => <span key={i} className={l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : ''}>{l}{'\n'}</span>)}</pre>
        : <p className="st-muted">Nenhuma mudança no settings.json; só o script do hook será atualizado.</p>}
      <div className="st-actions">
        <Button primary onClick={onConfirm}>Confirmar e gravar</Button>
        <Button onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  )
}

function ClaudeTab({ snap }: { snap: AppSnapshot }) {
  const [msg, setMsg] = useState('')
  const [prev, setPrev] = useState<HooksPreview | null>(null)
  const h = snap.hooks
  const run = async (f: () => Promise<unknown>, ok: string) => { try { await f(); setMsg(ok) } catch (e) { setMsg('Erro: ' + String((e as Error).message ?? e)) } }
  return <>
    <Card>
      <Row label="Claude Code CLI">{snap.cli.found ? <span className="st-ok">{snap.cli.version ?? 'instalado'}<small className="st-muted">{snap.cli.path}</small></span> : <span className="st-bad">Não encontrado no PATH</span>}</Row>
      <Row label="Instalação" hint="WSL: sessões dentro do WSL têm outro ~/.claude e não são vistas pelo pet (limitação documentada).">Nativa do Windows</Row>
      <Row label="Hooks" hint={h.settingsPath}><span className={h.installed ? 'st-ok' : 'st-bad'}>{h.installed ? `Instalados (${h.events.length} eventos)` : 'Não instalados'}</span></Row>
      <div className="st-actions">
        <Button primary disabled={!!prev} onClick={() => run(async () => setPrev(await window.pet.previewHooks()), '')}>{h.installed ? 'Reinstalar/atualizar…' : 'Instalar integração…'}</Button>
        <Button disabled={!h.installed} onClick={() => run(() => window.pet.uninstallHooks(), 'Integração removida; hooks de terceiros preservados.')}>Remover integração</Button>
      </div>
      {prev && <HooksDiff p={prev} onCancel={() => { setPrev(null); setMsg('Nada foi gravado.') }}
        onConfirm={() => run(async () => { await window.pet.installHooks(prev.token); setPrev(null) }, 'Hooks instalados. Reinicie as sessões abertas do Claude Code para que passem a emitir eventos.')} />}
      {msg && <p className="st-msg">{msg}</p>}
    </Card>
    <ProjectsCard snap={snap} />
    <UsageCard snap={snap} />
    <div className="st-warn">A instalação mostra antes a diferença no <code>settings.json</code> do Claude Code e só grava depois de você confirmar: faz <b>merge</b> preservando seus hooks, com backup em <code>~/.claude/backups</code>. Os hooks rodam assíncronos, nunca bloqueiam o Claude Code e só enviam: tipo do evento, ID da sessão, pasta, nome da ferramenta, status, tipo/ID de subagente, nome de membro de Agent Team e título curto de tarefa (até 120 caracteres). Nunca enviam prompts, comandos ou conteúdo de arquivos. Sessões já abertas só começam a emitir eventos após reiniciadas.</div>
    <KnownSessions snap={snap} />
  </>
}

const LIVE_PT = { active: 'ativa', unknown: 'desconhecida', ended: 'encerrada' }
const ORIGIN_PT = { cli: 'CLI', desktop: 'Desktop', chat: 'mini chat', unknown: 'origem ?' }

/** Mesma lista da aba Sessões. Botão direito numa linha → "Excluir do pet". */
export function KnownSessions({ snap }: { snap: AppSnapshot }) {
  const ended = snap.sessions.filter((s) => s.liveness === 'ended').map((s) => s.id)
  return <Card title="Sessões conhecidas">
    <div className="st-muted st-sessions">
      {snap.sessions.length ? snap.sessions.map((x) => (
        <div key={x.id} title="Botão direito: excluir do pet" onContextMenu={(e) => { e.preventDefault(); window.pet.contextMenu({ kind: 'session', id: x.id }) }}>
          {x.project} · {LIVE_PT[x.liveness]} · {ORIGIN_PT[x.origin]}
        </div>
      )) : 'Nenhuma'}
    </div>
    {ended.length > 0 && <div className="st-actions">
      <ConfirmButton sm label={`Excluir encerradas (${ended.length})`} confirmLabel={`Excluir ${ended.length} do pet?`} onConfirm={() => window.pet.forgetSessions(ended)} />
    </div>}
    <p className="st-note">Excluir tira só do pet; o histórico do Claude Code fica (o <code>claude --resume</code> continua achando). Botão direito numa linha exclui só ela.</p>
  </Card>
}

/** Projetos do mini chat e do "Abrir Claude Code". A aba Sessões não depende disto. */
function ProjectsCard({ snap }: { snap: AppSnapshot }) {
  const s = snap.settings
  const [msg, setMsg] = useState('')
  const def = snap.projects.find((p) => sameDir(p.path, s.defaultProject))
  const run = (f: () => Promise<unknown>) => f().then(() => setMsg('')).catch((e) => setMsg('Erro: ' + String((e as Error).message ?? e)))
  return <Card title="Projetos">
    <Row label="Lista de projetos" hint="Manual: só Fixados e Recentes que você escolher. Automática: pastas das sessões, sem pastas sensíveis.">
      <Segmented value={s.projectListMode} onChange={(v) => window.pet.setSettings({ projectListMode: v })} options={[{ id: 'manual', label: 'Manual' }, { id: 'auto', label: 'Automática' }]} />
    </Row>
    <Row label="Lembrar recentes" hint="Até 5. Pasta de usuário, raiz, .claude, AppData e Temp nunca entram."><Toggle label="Lembrar recentes" checked={s.recentProjects} onChange={(v) => window.pet.setSettings({ recentProjects: v })} /></Row>
    <Row label="Projeto padrão" hint="Sem padrão, o pet pergunta a pasta ao abrir o Claude Code.">
      <div className="st-inline">
        <select className="ui-select" value={def?.id ?? ''} title={s.defaultProject || 'Nenhum'} aria-label="Projeto padrão" onChange={(e) => run(() => window.pet.setDefaultProject(e.target.value || null))}>
          <option value="">Nenhum (perguntar)</option>
          <ProjectOptions projects={snap.projects.filter((p) => p.group !== 'session')} />
        </select>
        <Button sm onClick={() => run(async () => { const id = await window.pet.pickProject(); if (id) await window.pet.setDefaultProject(id) })}>Escolher pasta…</Button>
      </div>
    </Row>
    <ProjectManager projects={snap.projects} />
    <div className="st-actions"><Button sm disabled={!snap.projects.some((p) => p.group === 'recent')} onClick={() => run(() => window.pet.clearRecentProjects())}>Limpar recentes</Button></div>
    {msg && <p className="st-msg">{msg}</p>}
  </Card>
}

const BRIDGE_LABEL: Record<AppSnapshot['statusBridge'], string> = {
  installed: 'Instalada', chained: 'Status line existente encadeada', not_installed: 'Não instalada',
  conflict: 'Status line alterada depois da instalação', unreadable: 'settings.json inválido'
}

/** Faixa de uso: instala/remove só o campo statusLine do settings.json (nunca automático). */
function UsageCard({ snap }: { snap: AppSnapshot }) {
  const [msg, setMsg] = useState('')
  const [ask, setAsk] = useState(false)
  const st = snap.statusBridge
  const on = st === 'installed' || st === 'chained'
  const s = snap.settings
  const run = async (f: () => Promise<string>) => { try { setMsg(await f()) } catch (e) { setMsg('Erro: ' + String((e as Error).message ?? e)) } }
  const remove = (force: boolean) => run(async () => {
    const r = await window.pet.removeStatusBridge(force)
    if (r === 'conflict') { setAsk(true); return 'Sua status line foi alterada depois da instalação. Nada foi escrito: escolha abaixo.' }
    setAsk(false)
    return r === 'restored' ? 'Removida: settings.json restaurado exatamente como antes.'
      : r === 'field' ? 'Removida: statusLine voltou ao valor original (o resto do settings.json foi preservado).'
      : r === 'released' ? 'O pet esqueceu a instalação; sua status line atual não foi tocada.' : 'Nada a remover.'
  })
  return <Card title="Faixa de uso">
    <Row label="Status line" hint="Contexto, limites de 5 horas/semana e cache no mini chat."><span className={on ? 'st-ok' : 'st-bad'}>{BRIDGE_LABEL[st]}</span></Row>
    <p className="st-note">Instalar altera <b>só o campo <code>statusLine</code></b> do <code>settings.json</code>, com backup datado em <code>~/.claude/backups</code>. Se você já tiver uma status line, ela continua aparecendo igual (o pet a executa e repassa a saída). A ponte envia ao pet apenas números (porcentagens, tokens, horários de reinício) e o ID da sessão; não lê credenciais nem conteúdo de conversa. Sessões abertas só passam a enviar dados quando o Claude Code redesenha a status line.</p>
    <div className="st-actions">
      <Button primary onClick={() => run(async () => { const r = await window.pet.installStatusBridge(); setAsk(false); return `Status: ${BRIDGE_LABEL[r]}.` })}>{on ? 'Reinstalar faixa de uso' : 'Instalar faixa de uso'}</Button>
      <Button disabled={st === 'not_installed'} onClick={() => remove(false)}>Remover</Button>
    </div>
    {ask && <div className="st-actions">
      <Button onClick={() => remove(true)}>Manter a status line atual (só desligar no pet)</Button>
      <Button onClick={() => { setAsk(false); setMsg('Cancelado; nada mudou.') }}>Cancelar</Button>
    </div>}
    {msg && <p className="st-msg">{msg}</p>}
    <Row label="Mostrar faixa de uso"><Toggle label="Mostrar faixa de uso" checked={s.showUsageBand} onChange={(v) => window.pet.setSettings({ showUsageBand: v })} /></Row>
    <Row label="Texto mínimo na status line" hint="Só quando não há status line encadeada. Desligado = nada muda no seu terminal."><Toggle label="Texto mínimo na status line" checked={s.statuslineMinimal} onChange={(v) => window.pet.setSettings({ statuslineMinimal: v })} /></Row>
  </Card>
}

function Diag({ snap }: { snap: AppSnapshot }) {
  const [d, setD] = useState<{ logs: string[]; server: any; lastEvent: any; statusOverrides?: string[] } | null>(null)
  const [t, setT] = useState('')
  const load = () => window.pet.diagnostics().then((x) => setD(x as never))
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i) }, [])
  return <>
    <Card>
      <Row label="Serviço local">{snap.hooks.port ? <span className="st-ok">127.0.0.1:{snap.hooks.port}</span> : <span className="st-bad">parado</span>}</Row>
      <Row label="Ambiente" hint={snap.envMarkers.length ? `O pet foi iniciado de dentro do Claude Code (${snap.envMarkers.join(', ')}). Ele limpa isso ao abrir o Claude Code, mas o ideal é iniciar o pet pelo menu Iniciar.` : 'O pet não herdou marcadores do Claude Code.'}>
        {snap.envMarkers.length ? <span className="st-bad">Contaminado</span> : <span className="st-ok">Limpo</span>}
      </Row>
      <Row label="Eventos recebidos / rejeitados">{d ? `${d.server.received} / ${d.server.rejected}` : '…'}</Row>
      <Row label="Último evento">{d?.lastEvent ? `${d.lastEvent.event} (${d.lastEvent.sessionId}) ${new Date(d.lastEvent.at).toLocaleTimeString()}` : 'nenhum ainda'}</Row>
      <div className="st-actions">
        <Button onClick={async () => { setT('Testando…'); const r = await window.pet.selfTest(); setT((r.ok ? '✔ ' : '✘ ') + r.detail) }}>Testar conexão (hook → serviço)</Button>
        <Button onClick={async () => { const p = await window.pet.exportDiagnostics(); if (p) setT('Exportado: ' + p) }}>Exportar diagnóstico</Button>
      </div>
      {t && <p className="st-msg">{t}</p>}
    </Card>
    {!!d?.statusOverrides?.length && <div className="st-warn"><b>statusLine em settings de projeto/gerenciado.</b> Nestes arquivos ela sobrescreve a do usuário, e a faixa de uso não recebe dados dessas sessões (o pet não altera arquivos de projeto):<br />{d.statusOverrides.map((f) => <code key={f}>{f}<br /></code>)}</div>}
    <Card title="Logs (segredos ocultados)"><div className="st-log thin-scroll">{d?.logs.join('\n') || '(vazio)'}</div></Card>
  </>
}
