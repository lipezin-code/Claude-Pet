import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, nativeImage, safeStorage, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { pickDisplay, STATE_LABEL } from '../shared/machine'
import { AppSnapshot, ChatConversation, ManualProject, DEFAULT_SETTINGS, PetState, ProjectItem, Session, Settings } from '../shared/types'
import { dropConvs, runCli, runSdk, type Chunk } from './chat'
import { SESSION_ID_RE, desktopLaunch, findClaude, markerNames, openClaudeTerminal, validateCwd } from './claudeCli'
import { previewHooks, refreshHookScript, hooksStatus, installHooks, uninstallHooks, claudeDir, bridgeStatus, installStatusBridge, removeStatusBridge, setBridgeMinimal, statusLineOverrides } from './hooksInstall'
import { createEventServer } from './server'
import { SessionManager } from './sessions'
import { TranscriptReader, UsageStore } from './usage'
import { JsonStore, redact } from './store'
import { serializeMenu, type MenuNode } from './menuModel'
import { Projects, OpenRef, PROJECT_ID, SENSITIVE_WHY, blocksRecent, canonical } from './projects'
import { loadSkins, resolveSkinId } from './skins'
import { CLASSICO, SKIN_ID } from '../shared/skins'
import { agentOf, KINDS, LABEL_MAX, MAX_AGENTS, migrateTeamSkins, SLOTS, slotSkins, TEAM_NAME, type Slot } from '../shared/teams'
import { skinBitmap, TeamStore } from './teams'
import { knownSubagentTypes, readAgentTeams } from './agentTeams'
import { applyEdit, isWorktree, previewEdit, projectInfo, withGitignore, withRules, worktreeCommands, worktreePath } from './manualProject'
import { memberSkins, memberStatus } from '../shared/agentTeams'
import { CHAT_H, CHAT_W, createChat, createMenuWindow, placeMenu, createPet, createSettings, createTeams, clampToDisplays, petPad, petSize, snapScale, placeChat } from './windows'

// ---------- bootstrap ----------
// mesmo caminho que o hook lê (%APPDATA%\ClaudePet). CLAUDE_PET_DATA_DIR: só p/ testes (instância isolada:
// outro lock de instância única, outro settings/endpoint; o hook continua falando só com o app real).
const dataDir = process.env.CLAUDE_PET_DATA_DIR ? path.resolve(process.env.CLAUDE_PET_DATA_DIR) : path.join(app.getPath('appData'), 'ClaudePet')
app.setPath('userData', dataDir)

// Flags usadas pelo instalador/desinstalador NSIS: executam e saem, sem UI.
/** Conversa sem projeto roda aqui: pasta vazia do app (chat não tem ferramentas, a pasta só satisfaz o CLI). */
const chatDir = path.join(dataDir, 'chat')
const cliFlag = process.argv.find((a) => ['--install-hooks', '--uninstall-hooks', '--enable-autostart'].includes(a))

const res = (...p: string[]) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(app.getAppPath(), ...p))
const iconPath = res(app.isPackaged ? 'icon.png' : 'build/icon.png')
const trayPath = res(app.isPackaged ? 'tray.png' : 'build/tray.png')
const hookSrc = res(app.isPackaged ? 'claude-pet-hook.cjs' : 'hook/claude-pet-hook.cjs')
const bridgeSrc = res(app.isPackaged ? 'claude-pet-statusline.cjs' : 'hook/claude-pet-statusline.cjs')

const settingsStore = new JsonStore<Settings>(path.join(dataDir, 'settings.json'), DEFAULT_SETTINGS)
const sessionsStore = new JsonStore<{ list: Session[] }>(path.join(dataDir, 'sessions.json'), { list: [] })
const convStore = new JsonStore<{ list: ChatConversation[] }>(path.join(dataDir, 'conversations.json'), { list: [] })
const secretStore = new JsonStore<{ apiKey?: string }>(path.join(dataDir, 'secrets.json'), {})
const usageFile = new JsonStore<{ account: unknown }>(path.join(dataDir, 'usage.json'), { account: null }) // só limites da conta (números)
const home = app.getPath('home')
const projects = new Projects(path.join(dataDir, 'projects.json'), {
  home, claude: claudeDir(), temp: os.tmpdir(),
  appData: [process.env.APPDATA ?? '', process.env.LOCALAPPDATA ?? '', path.join(home, 'AppData')]
})

let settings: Settings = settingsStore.read()
settings.teamSkins = migrateTeamSkins(settings.teamSkins) // v anterior: skin por função fixa -> por posição do card
if (cliFlag) {
  try {
    if (cliFlag === '--install-hooks') installHooks(dataDir, hookSrc)
    else if (cliFlag === '--enable-autostart') { app.setLoginItemSettings({ openAtLogin: true }); settingsStore.write({ ...settings, autostart: true }) }
    else {
      uninstallHooks(); app.setLoginItemSettings({ openAtLogin: false })
      try { removeStatusBridge(dataDir) } catch { /* settings inválido: não mexe */ } // 'conflict' (statusLine de outro) = não escreve
      fs.rmSync(path.join(dataDir, 'hook'), { recursive: true, force: true }); fs.rmSync(path.join(dataDir, 'endpoint.json'), { force: true })
    }
  } catch (e) { fs.appendFileSync(path.join(dataDir, 'claude-pet.log'), `flag ${cliFlag} falhou: ${e}
`) }
  app.exit(0)
} else if (!app.requestSingleInstanceLock()) app.exit(0)
const token = randomBytes(24).toString('hex')
const envMarkers = markerNames() // pet iniciado de dentro do Claude Code? (só nomes; os processos que ele abre saem limpos)
const sessions = new SessionManager(path.join(claudeDir(), 'sessions'))
let pet: BrowserWindow, chat: BrowserWindow | null = null, settingsWin: BrowserWindow | null = null, tray: Tray
let cli: AppSnapshot['cli'] = { found: false }
let serverPort = 0
let lastEvent: unknown = null
let selftestAt = 0
let chatHiddenAt = 0
let quitting = false

// ---------- log (sem segredos) ----------
const logs: string[] = []
function log(msg: string) {
  const line = `${new Date().toISOString()} ${redact(msg)}`
  logs.push(line); if (logs.length > 300) logs.shift()
  try { fs.appendFileSync(path.join(dataDir, 'claude-pet.log'), line + '\n') } catch { /* ignora */ }
}

// ---------- skins (registry validado na inicialização; o renderer só recebe dados, nunca caminhos) ----------
const skins = loadSkins(res('skins'), log)
settings.skinId = resolveSkinId(settingsStore.read() as Partial<Settings>, skins, log)
if (!cliFlag) log(`skins: ${skins.size} carregadas (${[...skins.keys()].join(', ')}); ativa: ${settings.skinId}`)

// ---------- equipes (teams.json na pasta de dados; renderer manda só função + id de sessão) ----------
const teams = new TeamStore(path.join(dataDir, 'teams.json'), log)
/** Nome da função + ícone (mascote com a skin da posição) do agente dono da sessão, p/ as notificações. */
function slotBadge(slot: Slot, label: string) {
  const skin = skins.get(slotSkins(settings.teamSkins ?? {}, [...skins.keys()]).get(slot) ?? '') ?? CLASSICO
  const { buf, size } = skinBitmap(skin)
  return { label, icon: nativeImage.createFromBitmap(buf, { width: size, height: size }) }
}
// ---------- equipe manual: pasta do projeto (só leitura; escrita só em CLAUDE.md/.gitignore após confirmação) ----------
let manualInfo: ManualProject | null = null
const seenDelivery = new Map<string, string>()
async function refreshManual() {
  const t = teams.teams[0]
  const next = t?.projectPath ? await projectInfo(t.projectPath, t.agents) : null
  if (JSON.stringify(next) === JSON.stringify(manualInfo)) return
  // entrega nova (hash diferente do último visto) => notificação com nome e skin do card; a 1ª leitura só registra
  for (const a of t?.agents ?? []) {
    const h = next?.deliveries[a.id]?.hash, prev = seenDelivery.get(a.id)
    if (h) { seenDelivery.set(a.id, h); teams.rememberDelivery(a.id, next!.deliveries[a.id]) }
    if (h && prev !== h && (prev !== undefined || manualInfo)) notify(`entrega:${h}`, `${a.label} · Entregue para revisão`, next!.deliveries[a.id].subject, 'done', slotBadge(a.id, a.label).icon)
  }
  manualInfo = next; broadcast()
}
/** Arquivo editável da preparação: só estes dois, sempre dentro da pasta do projeto escolhida. */
function manualEdit(which: unknown) {
  const t = teams.teams[0]
  if (!t?.projectPath) throw new Error('Escolha a pasta do projeto primeiro')
  const w = z.enum(['claude', 'gitignore']).parse(which)
  if (w === 'gitignore') return { file: path.join(t.projectPath, '.gitignore'), next: withGitignore }
  const branch = manualInfo?.branch
  if (!branch) throw new Error('Não achei a branch atual da pasta (é um repositório git com um commit?)')
  return { file: path.join(t.projectPath, 'CLAUDE.md'), next: (cur: string | null) => withRules(cur, branch) }
}

/** Lê ~/.claude/teams (só leitura) e atualiza as equipes detectadas. */
function syncAgentTeams() {
  const list = sessions.list()
  const found = readAgentTeams(path.join(claudeDir(), 'teams'), log)
  const ambiguous = (f: { leadSessionId: string; members: { name: string }[] }) => {
    const k = knownSubagentTypes(claudeDir(), list.find((s) => s.id === f.leadSessionId)?.cwd)
    return f.members.filter((m) => k.has(m.name.toLowerCase())).map((m) => m.name)
  }
  if (teams.syncAgentTeams(found, new Set(list.map((s) => s.id)), ambiguous)) broadcast()
}
/** Membro de Agent Team concluiu / parou de responder: notifica com o nome e a skin dele. */
const prevMember = new Map<string, string>()
function evaluateMembers() {
  const list = sessions.list()
  const ids = [...skins.keys()]
  const leadSkin = slotSkins(settings.teamSkins ?? {}, ids).get('lider') ?? ''
  for (const t of teams.agentTeams) {
    const lead = list.find((s) => s.id === t.leadSessionId)
    const sk = memberSkins(t, ids, leadSkin)
    for (const m of t.members) {
      const key = `${t.id}:${m.name}`, st = memberStatus(t, m, lead), prev = prevMember.get(key)
      prevMember.set(key, st)
      if (prev === undefined || prev === st) continue
      const { buf, size } = skinBitmap(skins.get(sk.get(m.name) ?? '') ?? CLASSICO)
      const icon = nativeImage.createFromBitmap(buf, { width: size, height: size })
      if (st === 'done' && !settings.onlyImportant) notify(`mdone:${key}`, `${m.name} · Concluiu`, lead?.project ?? 'Agent Team', 'done', icon)
      else if (st === 'stalled') notify(`mstall:${key}`, `${m.name} · Parou de responder`, `${lead?.project ?? 'Agent Team'}: sem eventos há 2 min`, 'error', icon)
    }
  }
}
function agentBadge(sessionId: string) {
  const own = agentOf(teams.teams, sessionId)
  return own ? slotBadge(own.agent.id, own.agent.label) : null
}
function setSkin(id: unknown): string {
  if (typeof id !== 'string' || !SKIN_ID.test(id) || !skins.has(id)) throw new Error('Skin inválida')
  settings = { ...settings, skinId: id, mascot: id === 'azul' ? 'blob' : 'crab' }
  settingsStore.write(settings)
  broadcast()
  return id
}

// ---------- settings ----------
const SettingsPatch = z.object({
  scale: z.number().min(0.5).max(2), theme: z.enum(['dark', 'light']),
  animations: z.boolean(), reduceMotion: z.boolean(), opacity: z.number().min(0.3).max(1), alwaysOnTop: z.boolean(),
  doubleClick: z.enum(['none', 'chat', 'claude']), autostart: z.boolean(), notifications: z.boolean(),
  onlyImportant: z.boolean(), sounds: z.boolean(), volume: z.number().min(0).max(1), silent: z.boolean(),
  longTaskSeconds: z.number().min(5).max(3600), policy: z.enum(['attention', 'recent']),
  watchedSessionId: z.string().max(64).nullable(), projectListMode: z.enum(['manual', 'auto']), recentProjects: z.boolean(),
  chatEngine: z.enum(['cli', 'sdk']), chatModel: z.string().max(100),
  showUsageBand: z.boolean(), usageBandExpanded: z.boolean(), statuslineMinimal: z.boolean(),
  teamSkins: z.partialRecord(z.enum(SLOTS), z.string().regex(SKIN_ID))
}).partial().strict()

function applySettings(patch: unknown): Settings {
  const p = SettingsPatch.parse(patch)
  if (p.teamSkins && Object.values(p.teamSkins).some((id) => !skins.has(id!))) throw new Error('Skin inválida')
  if (p.scale !== undefined) p.scale = snapScale(p.scale) // passos de 10%
  settings = { ...settings, ...p }
  settingsStore.write(settings)
  if (p.scale !== undefined) resizePet()
  if (p.alwaysOnTop !== undefined) pet.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver')
  if (p.autostart !== undefined) app.setLoginItemSettings({ openAtLogin: settings.autostart })
  if (p.statuslineMinimal !== undefined) setBridgeMinimal(dataDir, settings.statuslineMinimal)
  broadcast()
  return settings
}

function resizePet() {
  const b = pet.getBounds()
  const { w, h } = petSize(settings.scale)
  // cresce para cima, mantém os "pés" e a borda esquerda do quadro do pet (a faixa do notebook fica à esquerda)
  const p = clampToDisplays(b.x + petPad(b.width) - petPad(w), b.y - (h - b.height), w, h)
  pet.setBounds({ ...p, width: w, height: h })
  settings.petPos = { x: p.x + petPad(w), y: p.y }
  settingsStore.write(settings)
}

// ---------- snapshot ----------
function snapshot(): AppSnapshot {
  const list = sessions.list().sort((a, b) => b.lastEventAt - a.lastEventAt)
  return { settings, skin: skins.get(settings.skinId) ?? CLASSICO, sessions: list, display: pickDisplay(list, settings), hooks: { ...hooksStatus(), port: serverPort }, usage: usage.snapshot(), statusBridge: bridgeStatus(dataDir), cli, projects: listProjects(), envMarkers, teams: teams.teams, agentTeams: teams.agentTeams, manualProject: manualInfo, version: app.getVersion() }
}
let bt: NodeJS.Timeout | null = null
function broadcast() {
  if (bt) return
  bt = setTimeout(() => {
    bt = null
    const s = snapshot()
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('snapshot', s)
    tray?.setToolTip(`Claude Pet — ${s.display.label}`)
  }, 60)
}

// ---------- notificações + sons ----------
const prevState = new Map<string, PetState>()
const activeSince = new Map<string, number>()
const lastNotified = new Map<string, number>()

function notify(key: string, title: string, body: string, kind: 'done' | 'ask' | 'error', icon: Electron.NativeImage | string = iconPath) {
  if (settings.silent) return
  const now = Date.now()
  if (now - (lastNotified.get(key) ?? 0) < 10_000) return // anti-repetição
  lastNotified.set(key, now)
  if (settings.notifications && Notification.isSupported()) {
    const n = new Notification({ title, body, silent: true, icon }) // silent: o som é nosso (volume configurável)
    n.on('click', () => showChat())
    n.show()
  }
  if (settings.sounds && !pet.isDestroyed()) pet.webContents.send('pet:sound', kind)
}

function evaluateTransitions() {
  const now = Date.now()
  for (const s of sessions.list()) {
    const prev = prevState.get(s.id)
    prevState.set(s.id, s.state)
    if (prev === s.state) continue
    const active = s.state === 'THINKING' || s.state === 'WORKING'
    if (active && !activeSince.has(s.id)) activeSince.set(s.id, now)
    const label = s.project
    // sessão de um agente: título com a função, ícone com a skin dela; as demais notificações ficam como antes
    const ag = agentBadge(s.id)
    const notify2 = (key: string, title: string, body: string, kind: 'done' | 'ask' | 'error') =>
      ag ? notify(key, `${ag.label} · ${title}`, body, kind, ag.icon) : notify(key, title, body, kind)
    if (s.state === 'WAITING_PERMISSION') notify2(`ask:${s.id}`, 'Claude pede autorização', `${label}${s.tool ? ` — ${s.tool}` : ''}`, 'ask')
    else if (s.state === 'ERROR') notify2(`err:${s.id}`, 'Falha na execução', `${label}: ${s.note ?? 'erro'}`, 'error')
    else if (ag && s.state === 'UNKNOWN' && (prev === 'WORKING' || prev === 'THINKING')) notify2(`stall:${s.id}`, 'Parou de responder', `${label}: sem eventos há 2 min`, 'error')
    else if (s.state === 'COMPLETED') {
      const dur = now - (activeSince.get(s.id) ?? now)
      const long = dur >= settings.longTaskSeconds * 1000
      if (!settings.onlyImportant || long)
        notify2(`done:${s.id}`, long ? 'Tarefa longa concluída' : 'Tarefa concluída', `${label}${long ? ` (${Math.round(dur / 1000)}s)` : ''}`, 'done')
    } else if (s.state === 'DISCONNECTED' && (prev === 'WORKING' || prev === 'THINKING' || prev === 'WAITING_PERMISSION'))
      notify2(`disc:${s.id}`, 'Sessão encerrada durante atividade', label, 'error')
    if (!active) activeSince.delete(s.id)
  }
}

// ---------- janelas ----------
function showChat() {
  if (!chat || chat.isDestroyed()) {
    chat = createChat(iconPath)
    chat.on('blur', () => { if (chat && !chat.isDestroyed() && chat.isVisible() && !chat.webContents.isDevToolsOpened()) { chat.hide(); chatHiddenAt = Date.now() } })
  }
  placeChat(chat, pet)
  chat.show(); chat.focus()
}
function toggleChat() {
  if (chat && !chat.isDestroyed() && chat.isVisible()) { chat.hide(); return }
  if (Date.now() - chatHiddenAt < 250) return // o blur acabou de esconder: o clique foi "fora do chat"
  showChat()
}
function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return }
  settingsWin = createSettings(iconPath)
}
let teamsWin: BrowserWindow | null = null
function showTeams() {
  if (teamsWin && !teamsWin.isDestroyed()) { if (teamsWin.isMinimized()) teamsWin.restore(); teamsWin.show(); teamsWin.focus(); return }
  teamsWin = createTeams(iconPath)
}

// ---------- projetos (o renderer só manda ids; caminhos nascem aqui: seletor nativo, conversas e sessões) ----------
const autoCandidates = () => settings.projectListMode === 'auto' ? [...sessions.list().map((s) => s.cwd), ...convStore.read().list.map((c) => c.cwd)].filter(Boolean) : []
function listProjects(): ProjectItem[] { return projects.list(settings.projectListMode, settings.recentProjects, autoCandidates()) }
const resolveProject = (id: unknown) => projects.resolve(id, settings.projectListMode, settings.recentProjects, autoCandidates())
/** Projeto padrão só se ainda existir e não for sensível. Nunca cai na pasta de usuário. */
function defaultCwd(): string | null { const p = canonical(settings.defaultProject); return p && !blocksRecent(projects.sensitivity(p)) ? p : null }

/** Seletor nativo + validação + confirmação de pasta sensível (padrão = Cancelar). */
async function pickProject(): Promise<{ id: string; path: string } | null> {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  const p = canonical(r.filePaths[0])
  const bad = p ? validateCwd(p) : 'Pasta não existe'
  if (!p || bad) { dialog.showErrorBox('Claude Pet', bad ?? 'Pasta inválida'); return null }
  const sens = projects.sensitivity(p)
  if (sens) {
    const a = await dialog.showMessageBox({
      type: 'warning', title: 'Claude Pet', buttons: ['Cancelar', 'Usar mesmo assim'], defaultId: 0, cancelId: 0, noLink: true,
      message: `Usar ${p}?`, detail: SENSITIVE_WHY[sens] + (blocksRecent(sens) ? ' Ela não será guardada em Recentes.' : '')
    })
    if (a.response !== 1) return null
  }
  const id = projects.add(p, settings.recentProjects)
  log(`projeto escolhido${sens ? ` (sensível: ${sens})` : ''}`)
  broadcast()
  return { id, path: p }
}
function setDefaultProject(id: unknown) {
  const p = id === null ? '' : resolveProject(id)
  if (p === null) throw new Error('Projeto inválido')
  if (p && blocksRecent(projects.sensitivity(p))) throw new Error('Pasta sensível não pode ser o projeto padrão')
  settings ={ ...settings, defaultProject: p }; settingsStore.write(settings); broadcast()
}

/** Pasta (e sessão a retomar) a partir de uma referência validada. Sem referência: padrão, senão pergunta. */
async function target(ref: OpenRef): Promise<{ cwd: string; resume?: string } | null> {
  if (!ref) { const d = defaultCwd(); if (d) return { cwd: d }; const p = await pickProject(); return p && { cwd: p.path } }
  if ('home' in ref) return { cwd: home }
  if ('pick' in ref) { const p = await pickProject(); return p && { cwd: p.path } }
  if ('project' in ref) { const p = resolveProject(ref.project); return p ? { cwd: p } : null }
  if ('conv' in ref) {
    const c = convStore.read().list.find((x) => x.id === ref.conv)
    if (!c) return null
    if (!c.cwd) { if (ref.resume && c.claudeSessionId) return { cwd: chatDir, resume: c.claudeSessionId }; const p = await pickProject(); return p && { cwd: p.path } }
    return { cwd: c.cwd, resume: ref.resume ? c.claudeSessionId : undefined }
  }
  const s = sessions.list().find((x) => x.id === ref.session)
  return s?.cwd ? { cwd: s.cwd, resume: s.id } : null
}

async function openClaude(ref?: unknown, opts: { agentTeams?: boolean } = {}) {
  const parsed = OpenRef.safeParse(ref)
  if (!parsed.success) return { ok: false, error: 'Referência inválida' }
  const t = await target(parsed.data)
  if (!t) return { ok: false, error: 'Nenhum projeto escolhido' }
  const r = await openClaudeTerminal(t.cwd, t.resume, opts)
  if (!r.ok) { log(`openClaude falhou: ${r.error}`); dialog.showErrorBox('Claude Pet', r.error ?? 'Falha ao abrir o Claude Code') }
  return r
}

// ---------- menu ----------

function menuTemplate(): MenuItemConstructorOptions[] {
  const live = sessions.list().filter((s) => s.liveness !== 'ended')
  const check = (c: boolean) => ({ type: 'checkbox' as const, checked: c })
  return [
    { label: 'Claude Pet', enabled: false },
    { label: `Estado: ${snapshot().display.label}`, enabled: false },
    { type: 'separator' },
    { label: 'Abrir mini chat', click: showChat },
    { label: 'Equipes', click: showTeams },
    {
      label: `Sessões ativas (${live.length})`,
      submenu: live.length ? [
        { label: 'Automático (política)', ...{ type: 'radio' as const, checked: !settings.watchedSessionId }, click: () => applySettings({ watchedSessionId: null }) },
        ...live.map((s) => ({ label: `${s.project} — ${STATE_LABEL[s.state]}`, type: 'radio' as const, checked: settings.watchedSessionId === s.id, click: () => applySettings({ watchedSessionId: s.id }) }))
      ] : [{ label: 'Nenhuma sessão', enabled: false }]
    },
    { label: 'Abrir Claude Code', click: () => openClaude() },
    {
      label: 'Selecionar projeto',
      submenu: [
        ...listProjects().map((p) => ({ label: p.name, sublabel: p.path, type: 'radio' as const, checked: p.path === settings.defaultProject, click: () => setDefaultProject(p.id) })),
        { label: 'Escolher pasta…', click: async () => { const p = await pickProject(); if (p) setDefaultProject(p.id) } }
      ]
    },
    { type: 'separator' }, // mascote
    { label: 'Alterar mascote', submenu: [...skins.values()].map((s) => ({ label: s.name, type: 'radio' as const, checked: settings.skinId === s.id, click: () => setSkin(s.id) })) },
    { label: 'Tamanho do pet', submenu: [0.5, 0.7, 1, 1.5, 2].map((v) => ({ label: `${Math.round(v * 100)}%`, type: 'radio' as const, checked: snapScale(settings.scale) === snapScale(v), click: () => applySettings({ scale: v }) })) },
    { label: 'Sempre visível', ...check(settings.alwaysOnTop), click: (i) => applySettings({ alwaysOnTop: i.checked }) },
    { type: 'separator' }, // sistema
    {
      label: 'Sons e notificações',
      submenu: [
        { label: 'Notificações', ...check(settings.notifications), click: (i) => applySettings({ notifications: i.checked }) },
        { label: 'Sons', ...check(settings.sounds), click: (i) => applySettings({ sounds: i.checked }) },
        { label: 'Modo silencioso', ...check(settings.silent), click: (i) => applySettings({ silent: i.checked }) }
      ]
    },
    { label: 'Iniciar com Windows', ...check(settings.autostart), click: (i) => applySettings({ autostart: i.checked }) },
    { type: 'separator' }, // app
    { label: 'Configurações', click: showSettings },
    { label: 'Ocultar pet (bandeja)', click: () => pet.hide() },
    { label: 'Sobre', click: () => dialog.showMessageBox({ title: 'Claude Pet', message: `Claude Pet ${app.getVersion()}`, detail: 'Companheiro visual do Claude Code. Projeto independente, não afiliado à Anthropic.' }) },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit() } }
  ]
}
const buildMenu = () => Menu.buildFromTemplate(menuTemplate()) // fallback nativo

// ---------- menu de contexto customizado (mesmo template do nativo; se algo falhar, cai no nativo) ----------
let menuWin: BrowserWindow | null = null
const menuHandlers = new Map<string, () => void>()
let menuTimer: NodeJS.Timeout | null = null
let menuModel: MenuNode[] = []

function showContextMenu() {
  try {
    menuHandlers.clear()
    const model: MenuNode[] = serializeMenu(menuTemplate(), menuHandlers)
    menuModel = model
    if (!menuWin || menuWin.isDestroyed()) {
      menuWin = createMenuWindow(iconPath)
      menuWin.on('blur', () => { if (menuWin && !menuWin.isDestroyed()) menuWin.hide() })
    }
    const w = menuWin
    const send = () => w.webContents.send('menu:model', model)
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send()
    // a janela só aparece quando o renderer informa a altura; se não responder, usa o menu nativo
    if (menuTimer) clearTimeout(menuTimer)
    menuTimer = setTimeout(() => { if (!w.isDestroyed() && !w.isVisible()) { log('menu customizado não respondeu; usando nativo'); buildMenu().popup({ window: pet }) } }, 2500)
  } catch (e) {
    log(`menu customizado falhou: ${e}`)
    buildMenu().popup({ window: pet })
  }
}

// ---------- chat ----------
const running = new Map<string, AbortController>()

const readKey = (): string | null => {
  const k = secretStore.read().apiKey
  if (!k || !safeStorage.isEncryptionAvailable()) return null
  try { return safeStorage.decryptString(Buffer.from(k, 'base64')) } catch { return null }
}

function saveConv(c: ChatConversation) {
  const all = convStore.read().list.filter((x) => x.id !== c.id)
  all.unshift({ ...c, updatedAt: Date.now() })
  convStore.write({ list: all.slice(0, 50) })
}
const SID = SESSION_ID_RE
const ids = (v: unknown, re: RegExp) => (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && re.test(x)).slice(0, 500)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function deleteConvs(list: string[]) {
  convStore.write({ list: dropConvs(convStore.read().list, list, running) })
}
/** Só tira do pet; transcrição do Claude Code intacta. */
function forgetSessions(list: string[]) {
  const gone = sessions.forget(list)
  if (!gone.length) return
  if (settings.watchedSessionId && gone.includes(settings.watchedSessionId)) applySettings({ watchedSessionId: null })
  sessionsStore.write({ list: sessions.list() })
  log(`sessões excluídas do pet: ${gone.length}`)
}

/** Botão direito → menu nativo. Resolve com a ação feita (o renderer recarrega o que precisar). */
function contextMenu(e: Electron.IpcMainInvokeEvent, ref: unknown): Promise<'deleted' | null> {
  const r = ref as { kind?: unknown; id?: unknown } | null
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
  let tpl: MenuItemConstructorOptions[] | null = null
  let done: 'deleted' | null = null
  const id = typeof r?.id === 'string' ? r.id : ''
  if (r?.kind === 'session' && SID.test(id)) {
    const s = sessions.list().find((x) => x.id === id)
    if (s) tpl = [{ label: s.liveness === 'active' ? 'Excluir do pet (sessão ativa)' : 'Excluir do pet', enabled: s.liveness !== 'active', click: () => { forgetSessions([id]); done = 'deleted' } }]
  } else if (r?.kind === 'project' && PROJECT_ID.test(id)) {
    tpl = [{ label: 'Remover da lista', click: () => { projects.remove(id); broadcast(); done = 'deleted' } }]
  } else if (r?.kind === 'conv' && UUID.test(id)) {
    tpl = [{ label: running.has(id) ? 'Excluir conversa (respondendo…)' : 'Excluir conversa', enabled: !running.has(id), click: () => { deleteConvs([id]); done = 'deleted' } }]
  }
  if (!tpl) return Promise.resolve(null)
  return new Promise((resolve) => Menu.buildFromTemplate(tpl!).popup({ window: win, callback: () => setImmediate(() => resolve(done)) }))
}

const toChat = (e: unknown) => { if (chat && !chat.isDestroyed()) chat.webContents.send('chat:event', e) }

async function sendChat(convId: string, text: string) {
  const conv = convStore.read().list.find((c) => c.id === convId)
  if (!conv) throw new Error('Conversa não encontrada')
  if (running.has(convId)) throw new Error('Já existe uma resposta em andamento')
  const cwd = conv.cwd || chatDir
  if (!conv.cwd) fs.mkdirSync(chatDir, { recursive: true })
  const bad = validateCwd(cwd)
  if (bad) { toChat({ type: 'error', convId, message: `Projeto inválido: ${bad}` }); return }
  conv.messages.push({ id: randomUUID(), role: 'user', text, ts: Date.now() })
  if (conv.messages.length === 1) conv.title = text.slice(0, 40)
  saveConv(conv)
  const ac = new AbortController()
  running.set(convId, ac)
  let answer = ''
  let failed = false
  const onChunk = (c: Chunk) => {
    if (c.kind === 'delta') { answer += c.text; toChat({ type: 'delta', convId, text: c.text }) }
    else if (c.kind === 'session') { conv.claudeSessionId = c.id; sessions.markChat(c.id, cwd) }
    else if (c.kind === 'result' && c.isError) { failed = true; conv.messages.push({ id: randomUUID(), role: 'error', text: c.text ?? 'Erro', ts: Date.now() }); toChat({ type: 'error', convId, message: c.text ?? 'Erro' }) }
  }
  const opts = { prompt: text, cwd, resume: conv.claudeSessionId, model: settings.chatModel || 'sonnet', signal: ac.signal, onChunk }
  try {
    if (settings.chatEngine === 'sdk') {
      const key = readKey()
      if (!cli.found) onChunk({ kind: 'result', isError: true, text: 'Motor SDK usa o executável do Claude Code instalado; ele não foi encontrado no PATH.' })
      else if (!key) { onChunk({ kind: 'result', isError: true, text: 'Motor SDK exige chave de API (Configurações > Chat). Ou use o motor CLI, que usa seu login do Claude Code.' }) }
      else await runSdk(key, opts, cli.path)
    } else {
      if (!cli.found || !cli.path) onChunk({ kind: 'result', isError: true, text: 'Claude Code CLI não encontrado no PATH.' })
      else await runCli(cli.path, opts)
    }
  } finally {
    running.delete(convId)
    if (conv.claudeSessionId) sessions.chatDone(conv.claudeSessionId)
    if (answer) conv.messages.push({ id: randomUUID(), role: 'assistant', text: answer, ts: Date.now() })
    saveConv(conv)
    if (!failed) toChat({ type: 'done', convId, claudeSessionId: conv.claudeSessionId })
  }
}

// ---------- IPC ----------
function ipc() {
  ipcMain.handle('snapshot', () => snapshot())
  ipcMain.handle('settings:set', (_e, p) => applySettings(p))
  ipcMain.handle('skins:list', () => [...skins.values()])
  ipcMain.handle('skin:set', (_e, id: unknown) => setSkin(id)) // só um id; validado contra o registry

  // pet: arraste por delta; clique/duplo/menu
  ipcMain.on('pet:drag', (_e, dx: number, dy: number) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const b = pet.getBounds()
    pet.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height }) // size fixo: evita bug de DPI fracionário
    if (chat && !chat.isDestroyed() && chat.isVisible()) placeChat(chat, pet)
  })
  ipcMain.on('pet:drag-end', () => {
    const b = pet.getBounds(); const p = clampToDisplays(b.x, b.y, b.width, b.height)
    pet.setBounds({ ...p, width: b.width, height: b.height })
    settings.petPos = { x: p.x + petPad(b.width), y: p.y }; settingsStore.write(settings) // canto do quadro do pet
  })
  ipcMain.on('pet:ignore', (_e, ignore: boolean) => pet.setIgnoreMouseEvents(!!ignore, { forward: true }))
  ipcMain.on('pet:click', toggleChat)
  ipcMain.on('pet:double', () => { if (settings.doubleClick === 'claude') openClaude({ home: true }); else if (settings.doubleClick === 'chat') showChat() })
  ipcMain.on('pet:menu', showContextMenu)
  ipcMain.handle('menu:model', (e) => (menuWin && !menuWin.isDestroyed() && e.sender === menuWin.webContents ? menuModel : []))
  ipcMain.on('menu:size', (e, h: number) => {
    if (!menuWin || menuWin.isDestroyed() || e.sender !== menuWin.webContents || !Number.isFinite(h)) return
    if (menuTimer) { clearTimeout(menuTimer); menuTimer = null }
    placeMenu(menuWin, pet, Math.min(640, Math.max(80, h)))
    menuWin.show(); menuWin.focus()
  })
  ipcMain.on('menu:click', (e, id: string) => {
    if (!menuWin || e.sender !== menuWin.webContents) return
    const fn = menuHandlers.get(String(id))
    menuWin.hide()
    if (fn) setImmediate(fn)
  })
  ipcMain.on('menu:close', (e) => { if (menuWin && e.sender === menuWin.webContents) menuWin.hide() })

  ipcMain.on('view:open', (_e, v) => { if (v === 'chat') showChat(); else if (v === 'settings') showSettings(); else if (v === 'teams') showTeams() })
  ipcMain.on('chat:hide', () => chat?.hide())

  ipcMain.handle('claude:open', (_e, ref: unknown) => openClaude(ref))
  // modo equipe: só um booleano fixo vem do main (o renderer não escolhe variáveis de ambiente)
  ipcMain.handle('claude:open-team', () => openClaude({ pick: true }, { agentTeams: true }))
  ipcMain.handle('folder:open', async (_e, ref: unknown) => {
    const r = OpenRef.safeParse(ref)
    const t = r.success && r.data && !('session' in r.data) ? await target(r.data) : null
    const bad = t ? validateCwd(t.cwd) : 'Projeto inválido'; if (bad || !t) return { ok: false, error: bad }
    const err = await shell.openPath(t.cwd); return err ? { ok: false, error: err } : { ok: true }
  })
  const pid = (id: unknown) => { if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw new Error('Projeto inválido'); return id }
  ipcMain.handle('projects:pick', async () => (await pickProject())?.id ?? null)
  ipcMain.handle('projects:pin', (_e, id: unknown, on: unknown) => { projects.pin(pid(id), on === true); broadcast() })
  ipcMain.handle('projects:remove', (_e, id: unknown) => { projects.remove(pid(id)); broadcast() })
  ipcMain.handle('projects:clear-recent', () => { projects.clearRecent(); broadcast() })
  ipcMain.handle('projects:default', (_e, id: unknown) => setDefaultProject(id))
  ipcMain.handle('desktop:open', () => {
    const l = desktopLaunch(process.env.LOCALAPPDATA ?? '', fs.existsSync)
    if (!l) return { ok: false, error: 'Claude Desktop não encontrado' }
    execFile(l.file, l.args, { windowsHide: false }, () => {}).unref() // explorer.exe sai com código 1 mesmo abrindo: ignora
    return { ok: true }
  })
  ipcMain.on('clipboard:write', (_e, t: string) => clipboard.writeText(String(t).slice(0, 100_000)))
  ipcMain.on('session:pin', (_e, id: string, pinned: boolean) => sessions.setPinned(String(id), !!pinned))
  ipcMain.on('session:watch', (_e, id: string | null) => applySettings({ watchedSessionId: id }))

  // equipes: o renderer manda só a posição do card e o id da sessão; a pasta vem da sessão conhecida pelo main
  const SlotId = z.enum(SLOTS)
  ipcMain.handle('teams:bind', (_e, slot: unknown, sid: unknown) => {
    const r = SlotId.parse(slot)
    if (sid === null) teams.bind(r, null)
    else {
      const s = sessions.list().find((x) => x.id === z.string().regex(SID).parse(sid))
      if (!s) throw new Error('Sessão desconhecida')
      teams.bind(r, { id: s.id, cwd: s.cwd })
    }
    broadcast()
  })
  // montar/editar a equipe: validação de forma aqui; nomes, slugs e repetição em buildRoster (mesma regra da tela)
  const Row = z.object({ id: z.enum(SLOTS).exclude(['lider']).optional(), kind: z.enum(KINDS), label: z.string().max(LABEL_MAX * 2) }).strict()
  ipcMain.handle('teams:roster', (_e, rows: unknown) => { teams.setRoster(z.array(Row).max(MAX_AGENTS + 1).parse(rows)); broadcast() })
  // equipe manual: preparação do projeto
  ipcMain.handle('manual:pick', async () => { const p = await pickProject(); if (!p) return false; teams.setProject(p.path); await refreshManual(); broadcast(); return true })
  ipcMain.handle('manual:preview', (_e, which: unknown) => { const m = manualEdit(which); const p = previewEdit(m.file, m.next); return { ...p, diff: redact(p.diff) } })
  ipcMain.handle('manual:apply', async (_e, which: unknown, token: unknown) => {
    const m = manualEdit(which)
    const wrote = applyEdit(m.file, m.next, z.string().regex(/^[0-9a-f]{64}$/).parse(token))
    log(`equipe manual: ${path.basename(m.file)} ${wrote ? 'atualizado após confirmação' : 'sem mudança'}`)
    await refreshManual(); return wrote
  })
  ipcMain.handle('manual:copyWorktrees', () => {
    const t = teams.teams[0]
    if (!t?.projectPath) throw new Error('Escolha a pasta do projeto primeiro')
    const text = worktreeCommands(t.projectPath, t.agents) // só copia; o pet nunca executa
    clipboard.writeText(text); return text
  })
  ipcMain.handle('manual:open', async (_e, slot: unknown) => {
    const t = teams.teams[0], id = z.enum(SLOTS).parse(slot)
    const a = t?.agents.find((x) => x.id === id)
    if (!t?.projectPath || !a) throw new Error('Escolha a pasta do projeto primeiro')
    const dir = id === 'lider' ? t.projectPath : worktreePath(t.projectPath, a.slug)
    if (id !== 'lider' && !isWorktree(dir)) throw new Error(`O worktree de ${a.label} ainda não existe. Use "Copiar comandos de worktree" e rode no terminal.`)
    teams.setWorktree(id, dir) // o revínculo pela pasta liga a sessão nova a este card
    broadcast()
    return openClaudeTerminal(dir)
  })
  ipcMain.handle('agentTeams:remove', (_e, list: unknown) => { if (teams.removeAgentTeams(z.array(z.string().max(80)).max(20).parse(list))) broadcast() })
  ipcMain.handle('teams:set', (_e, p: unknown) => { teams.setTeam(z.object({ name: z.string().regex(TEAM_NAME), goal: z.string().max(300) }).partial().strict().parse(p)); broadcast() })

  ipcMain.handle('chat:list', () => convStore.read().list)
  ipcMain.handle('chat:new', (_e, projectId: unknown) => {
    const cwd = projectId == null ? '' : resolveProject(projectId) // sem projeto = só conversa
    if (cwd === null) throw new Error('Projeto inválido')
    convStore.write({ list: convStore.read().list.filter((c) => c.messages.length) }) // conversa vazia não acumula ("Nova conversa" repetida)
    const c: ChatConversation = { id: randomUUID(), title: 'Nova conversa', cwd, messages: [], updatedAt: Date.now() }
    saveConv(c); return c
  })
  ipcMain.handle('chat:delete', (_e, list: unknown) => deleteConvs(ids(list, UUID)))
  ipcMain.handle('session:forget', (_e, list: unknown) => forgetSessions(ids(list, SID)))
  ipcMain.handle('ctx:menu', contextMenu)
  ipcMain.handle('chat:send', (_e, id: string, text: string) => sendChat(String(id), String(text).slice(0, 50_000)))
  ipcMain.on('chat:stop', (_e, id: string) => running.get(String(id))?.abort())

  // prévia primeiro (nada é gravado); instalar exige o token da prévia confirmada. Diff passa por redact (env com chaves).
  ipcMain.handle('hooks:preview', () => { const p = previewHooks(dataDir); return { ...p, diff: redact(p.diff) } })
  ipcMain.handle('hooks:install', (_e, token: unknown) => {
    const s = installHooks(dataDir, hookSrc, z.string().regex(/^[0-9a-f]{64}$/).parse(token))
    log('hooks instalados (após prévia confirmada)'); broadcast(); return s
  })
  ipcMain.handle('hooks:uninstall', () => { const s = uninstallHooks(); log('hooks removidos'); broadcast(); return s })
  ipcMain.handle('statusline:install', () => { const s = installStatusBridge(dataDir, bridgeSrc, settings.statuslineMinimal); log(`faixa de uso: ponte instalada (${s})`); broadcast(); return s })
  ipcMain.handle('statusline:uninstall', (_e, force: unknown) => { const r = removeStatusBridge(dataDir, force === true); log(`faixa de uso: remoção ${r}`); broadcast(); return r })
  ipcMain.handle('key:set', (_e, k: string) => {
    if (!k) { secretStore.write({}); return true }
    if (!safeStorage.isEncryptionAvailable()) return false
    secretStore.write({ apiKey: safeStorage.encryptString(String(k)).toString('base64') }); return true
  })
  ipcMain.handle('key:has', () => !!readKey())
  ipcMain.handle('diag:get', () => ({ logs: logs.slice(-100), server: server.stats, lastEvent, statusOverrides: statusLineOverrides([app.getPath('home'), ...sessions.list().map((s) => s.cwd)]) }))
  ipcMain.handle('diag:selftest', () => selfTest())
  ipcMain.handle('diag:export', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: 'claude-pet-diagnostico.json' })
    if (r.canceled || !r.filePath) return null
    const { watchedSessionId: _w, defaultProject: _d, petPos: _p, ...safeSettings } = settings
    fs.writeFileSync(r.filePath, JSON.stringify({
      app: app.getVersion(), electron: process.versions.electron, os: process.getSystemVersion(), cli, hooks: hooksStatus(),
      settings: safeSettings, envClean: envMarkers.length === 0, server: server.stats, sessions: sessions.list().map((s) => ({ state: s.state, liveness: s.liveness, origin: s.origin, lastEventAt: s.lastEventAt })),
      logs: logs.slice(-200)
    }, null, 2))
    return r.filePath
  })
}

/** 1ª execução com a lista nova: backup do settings.json e lista antiga → Recentes (filtrados, nada fixado). */
function migrateProjects() {
  if (projects.exists()) return
  const sf = path.join(dataDir, 'settings.json')
  try { if (fs.existsSync(sf)) fs.copyFileSync(sf, path.join(dataDir, `settings.backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)) } catch (e) { log(`backup do settings falhou: ${e}`) }
  const recent = projects.migrate([
    settings.defaultProject,
    ...convStore.read().list.sort((a, b) => b.updatedAt - a.updatedAt).map((c) => c.cwd),
    ...sessionsStore.read().list.sort((a, b) => b.lastEventAt - a.lastEventAt).map((s) => s.cwd)
  ])
  const d = defaultCwd() ?? ''
  if (d !== settings.defaultProject) { settings = { ...settings, defaultProject: d }; settingsStore.write(settings) }
  log(`projetos: migração com ${recent.length} recente(s); padrão ${d ? 'mantido' : 'vazio'}`)
}

/** Roda o hook instalado com um evento sintético e espera o servidor recebê-lo. */
async function selfTest(): Promise<{ ok: boolean; detail: string }> {
  const hook = path.join(dataDir, 'hook', 'claude-pet-hook.cjs')
  if (!fs.existsSync(hook)) return { ok: false, detail: 'Hook não instalado (Configurações > Claude Code).' }
  const before = selftestAt
  await new Promise<void>((resolve) => {
    const p = execFile(process.execPath, [hook], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 5000 }, () => resolve())
    p.stdin?.end(JSON.stringify({ session_id: 'pet-selftest', hook_event_name: 'Notification', cwd: dataDir }))
  })
  await new Promise((r) => setTimeout(r, 300))
  return selftestAt > before ? { ok: true, detail: `Hook → serviço local OK (porta ${serverPort}).` } : { ok: false, detail: 'O serviço não recebeu o evento de teste.' }
}

// ---------- faixa de uso ----------
const usage = new UsageStore()
usage.restoreAccount(usageFile.read().account)
const transcripts = new TranscriptReader(path.join(claudeDir(), 'projects'), (sid, t) => { usage.setTotals(sid, t); broadcast() }, log)
let usageSaveT: NodeJS.Timeout | null = null
const saveUsageSoon = () => { usageSaveT ??= setTimeout(() => { usageSaveT = null; usageFile.write({ account: usage.account }) }, 5000) }

// ---------- main ----------
const server = createEventServer(token, (e) => {
  lastEvent = { event: e.event, sessionId: e.sessionId.slice(0, 8), at: e.ts }
  if (e.sessionId === 'pet-selftest') { selftestAt = Date.now(); return }
  log(`evento ${e.event} ${e.sessionId.slice(0, 8)}${e.tool ? ' ' + e.tool : ''}${e.agentId ? ` agent=${e.agentId.slice(0, 24)}` : ''}${e.agentType ? ` tipo=${e.agentType}` : ''}${e.agentName ? ` nome=${e.agentName}` : ''}${e.teammate ? ` membro=${e.teammate}` : ''}${e.taskId ? ` task=${e.taskId}` : ''}`)
  sessions.ingest(e)
}, (u) => {
  if (u.sessionId === 'pet-selftest') { selftestAt = Date.now(); return }
  if (usage.apply(u)) saveUsageSoon()
  transcripts.update(u.sessionId)
  broadcast()
}, log)

app.on('second-instance', (_e, argv) => { pet?.showInactive(); if (argv.includes('--settings')) showSettings(); else if (argv.includes('--menu')) showContextMenu(); else showChat() })
app.on('window-all-closed', () => { /* vive na bandeja */ })
app.on('before-quit', () => { quitting = true; try { fs.rmSync(path.join(dataDir, 'endpoint.json'), { force: true }) } catch { /* ok */ } })

app.whenReady().then(async () => {
  if (cliFlag) return
  fs.mkdirSync(dataDir, { recursive: true })
  serverPort = await server.listen()
  fs.writeFileSync(path.join(dataDir, 'endpoint.json'), JSON.stringify({ port: serverPort, token }), { mode: 0o600 })
  log(`serviço local em 127.0.0.1:${serverPort}`)
  if (refreshHookScript(dataDir, hookSrc)) log('hook atualizado para a versão do app')
  if (envMarkers.length) log(`ambiente herdado do Claude Code (${envMarkers.join(', ')}); removido nos processos que o pet abre`)

  sessions.restore(sessionsStore.read().list)
  sessions.discover()
  sessions.on('change', () => { teams.autoBind(sessions.list()); evaluateTransitions(); evaluateMembers(); broadcast() })
  setInterval(() => sessions.tickAll(), 2000)
  setInterval(() => { sessions.discover(); sessions.prune(); syncAgentTeams(); void refreshManual() }, 5000)
  void refreshManual()
  setInterval(() => sessionsStore.write({ list: sessions.list() }), 15_000)
  findClaude().then((c) => { cli = c; broadcast() })

  migrateProjects()
  ipc()
  pet = createPet(iconPath, settings.petPos, settings.scale)
  tray = new Tray(nativeImage.createFromPath(trayPath))
  tray.setToolTip('Claude Pet')
  tray.on('click', () => { if (!pet.isVisible()) pet.showInactive(); else toggleChat() })
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar/ocultar pet', click: () => (pet.isVisible() ? pet.hide() : pet.showInactive()) },
    { label: 'Abrir mini chat', click: showChat },
    { label: 'Equipes', click: showTeams },
    { label: 'Configurações', click: showSettings },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit() } }
  ]))
  if (process.argv.includes('--settings')) showSettings()
  void CHAT_W; void CHAT_H; void quitting
})
