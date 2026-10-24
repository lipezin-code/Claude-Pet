export type PetState =
  | 'IDLE' | 'THINKING' | 'WORKING' | 'WAITING_PERMISSION'
  | 'COMPLETED' | 'ERROR' | 'DISCONNECTED' | 'UNKNOWN'

export type HookName =
  | 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse'
  | 'PostToolUseFailure' | 'PermissionRequest' | 'Notification' | 'Stop' | 'StopFailure'
  | 'SubagentStart' | 'SubagentStop' | 'TaskCreated' | 'TaskCompleted'

/** Evento já normalizado (sem prompt, sem tool_input: privacidade). */
export interface HookEvent {
  sessionId: string
  event: string
  ts: number
  cwd?: string
  tool?: string
  agentId?: string
  agentType?: string // subagente: tipo (ex.: Explore, implementador)
  agentName?: string // ferramenta Agent: `name` do membro lançado (Agent Teams); nada mais do tool_input
  source?: string
  notificationType?: string
  message?: string
  error?: string
  taskSubject?: string
  taskId?: string // TaskCreated/TaskCompleted
  teammate?: string // Agent Teams: nome do membro (TeammateIdle, Task*)
}

export type Liveness = 'active' | 'unknown' | 'ended'
export type Origin = 'cli' | 'desktop' | 'chat' | 'unknown'

export interface Session {
  id: string
  cwd: string
  project: string
  state: PetState
  stateSince: number
  lastEventAt: number // 0 = nunca recebemos evento (só descoberta)
  tool?: string
  pid?: number
  origin: Origin
  liveness: Liveness
  pinned: boolean
  subagents: number
  subs?: import('./subagents').SubAgent[] // subagentes desta sessão (ver shared/subagents.ts)
  teamTasks?: Record<string, { subject: string; done: boolean }> // Agent Teams: última tarefa por membro (TaskCreated/TaskCompleted)
  note?: string
  log: { ts: number; event: string; tool?: string }[]
}

export interface Settings {
  mascot: 'crab' | 'blob' // legado: mantido em sincronia com skinId (azul <-> blob) p/ compatibilidade
  skinId: string
  scale: number // 0.5..2
  theme: 'dark' | 'light'
  animations: boolean
  reduceMotion: boolean
  opacity: number
  alwaysOnTop: boolean
  doubleClick: 'none' | 'chat' | 'claude'
  autostart: boolean
  notifications: boolean
  onlyImportant: boolean
  sounds: boolean
  volume: number
  silent: boolean
  longTaskSeconds: number
  policy: 'attention' | 'recent'
  watchedSessionId: string | null
  defaultProject: string // só o main grava (a partir de um id validado)
  projectListMode: 'manual' | 'auto' // manual = só Fixados + Recentes escolhidos
  recentProjects: boolean
  chatEngine: 'cli' | 'sdk'
  chatModel: string
  petPos: { x: number; y: number } | null
  showUsageBand: boolean
  usageBandExpanded: boolean
  statuslineMinimal: boolean // sem status line encadeada: imprime um texto mínimo em vez de nada
  teamSkins: Partial<Record<import('./teams').Slot, string>> // skin de cada posição de card (Líder, Agente 1..5); vazio = automática
}

export const DEFAULT_SETTINGS: Settings = {
  mascot: 'crab', skinId: 'classico', scale: 1, theme: 'dark', animations: true, reduceMotion: false, opacity: 1,
  alwaysOnTop: true, doubleClick: 'claude', autostart: false, notifications: true,
  onlyImportant: false, sounds: true, volume: 0.5, silent: false, longTaskSeconds: 60,
  policy: 'attention', watchedSessionId: null, defaultProject: '', projectListMode: 'manual', recentProjects: true, chatEngine: 'cli',
  chatModel: '', petPos: null,
  showUsageBand: true, usageBandExpanded: false, statuslineMinimal: false, teamSkins: {}
}

/** Item do seletor de projetos. O renderer recebe o caminho só para exibir; de volta manda só o id. */
export interface ProjectItem { id: string; path: string; name: string; group: 'pinned' | 'recent' | 'session' | 'auto' }

export interface ChatMessage { id: string; role: 'user' | 'assistant' | 'error'; text: string; ts: number }
export interface ChatConversation { id: string; title: string; cwd: string; claudeSessionId?: string; messages: ChatMessage[]; updatedAt: number }

export type ChatEvent =
  | { type: 'delta'; convId: string; text: string }
  | { type: 'done'; convId: string; claudeSessionId?: string }
  | { type: 'error'; convId: string; message: string }

export interface AppSnapshot {
  settings: Settings
  skin: import('./skins').Skin // skin ativa já validada pelo registry
  sessions: Session[]
  display: { state: PetState; sessionId: string | null; label: string }
  hooks: HooksStatus
  usage: import('./usage').UsageSnapshot // só números (faixa de uso)
  statusBridge: BridgeState
  cli: { found: boolean; path?: string; version?: string }
  projects: ProjectItem[]
  envMarkers: string[] // só NOMES dos marcadores do Claude Code herdados pelo pet, nunca valores
  teams: import('./teams').Team[]
  agentTeams: import('./agentTeams').AgentTeam[] // Agent Teams do Claude Code detectadas (só dados validados)
  manualProject: ManualProject | null // equipe manual: estado da pasta do projeto (só leitura)
  version: string
}

/** Equipe manual: preparação do projeto (lida pelo main a cada ciclo). Caminhos só para exibir. */
export interface ManualProject {
  path: string
  name: string
  branch: string | null // branch atual da pasta do líder; null = não é git / HEAD destacado / nome fora do padrão
  claudeMd: 'missing' | 'no-rules' | 'ok'
  gitignore: 'missing' | 'no-entry' | 'ok'
  worktrees: Record<string, { path: string; ready: boolean }> // por posição do card
  tasks: Record<string, string> // .equipe/tarefas/<slug>.md por posição (texto limitado; exibido como texto puro)
  // último commit "ENTREGA:" da branch; merged = já está na base; hasBase = a entrega já contém a base atual (atualizou com a base)
  deliveries: Record<string, { hash: string; at: number; subject: string; stat: string; merged: boolean; hasBase: boolean }>
  verdicts: Record<string, { kind: 'approved' | 'changes'; hash: string; notes: string }> // .equipe/revisoes/<slug>.md
}

/** Ponte da status line: 'conflict' = instalamos, mas a statusLine foi trocada depois; 'unreadable' = settings.json inválido. */
export type BridgeState = 'installed' | 'chained' | 'not_installed' | 'conflict' | 'unreadable'

export interface HooksStatus { installed: boolean; events: string[]; settingsPath: string; port?: number }
