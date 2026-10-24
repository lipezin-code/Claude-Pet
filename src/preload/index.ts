import { contextBridge, ipcRenderer } from 'electron'
import type { AppSnapshot, ChatConversation, ChatEvent, Settings } from '../shared/types'
import type { Skin } from '../shared/skins'

// Superfície mínima exposta ao renderer. Nada de Node, nada de ipcRenderer cru.
const on = <T>(ch: string, cb: (v: T) => void) => {
  const h = (_: unknown, v: T) => cb(v)
  ipcRenderer.on(ch, h)
  return () => { ipcRenderer.removeListener(ch, h) }
}
const inv = <T = unknown>(ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a) as Promise<T>

const api = {
  snapshot: () => inv<AppSnapshot>('snapshot'),
  onSnapshot: (cb: (s: AppSnapshot) => void) => on('snapshot', cb),
  setSettings: (p: Partial<Settings>) => inv<Settings>('settings:set', p),
  // skins: só dados (id, nome, swatches, cores, flags); a ativa vem em snapshot().skin
  listSkins: () => inv<Skin[]>('skins:list'),
  setSkin: (id: string) => inv<string>('skin:set', String(id)),

  // pet
  dragBy: (dx: number, dy: number) => ipcRenderer.send('pet:drag', dx, dy),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  ignoreMouse: (ignore: boolean) => ipcRenderer.send('pet:ignore', ignore),
  petClick: () => ipcRenderer.send('pet:click'),
  petDouble: () => ipcRenderer.send('pet:double'),
  petMenu: () => ipcRenderer.send('pet:menu'),
  onSound: (cb: (k: 'done' | 'ask' | 'error') => void) => on('pet:sound', cb),

  // menu de contexto customizado (janela própria)
  onMenu: (cb: (m: import('../main/menuModel').MenuNode[]) => void) => on('menu:model', cb),
  menuModel: () => inv<import('../main/menuModel').MenuNode[]>('menu:model'),
  menuSize: (h: number) => ipcRenderer.send('menu:size', h),
  menuClick: (id: string) => ipcRenderer.send('menu:click', id),
  menuClose: () => ipcRenderer.send('menu:close'),

  // janelas
  openView: (v: 'chat' | 'settings' | 'teams') => ipcRenderer.send('view:open', v),
  hideChat: () => ipcRenderer.send('chat:hide'),

  // sessões / claude code: só referências (ids); o main resolve a pasta
  openClaude: (ref?: { home: true } | { pick: true } | { project: string } | { conv: string; resume?: boolean } | { session: string }) => inv<{ ok: boolean; error?: string }>('claude:open', ref),
  /** Abre o Claude Code com Agent Teams ligado só nessa janela (pede a pasta). */
  openClaudeTeam: () => inv<{ ok: boolean; error?: string }>('claude:open-team'),
  openFolder: (ref: { project: string } | { conv: string }) => inv<{ ok: boolean; error?: string }>('folder:open', ref),
  openDesktop: () => inv<{ ok: boolean; error?: string }>('desktop:open'),
  copy: (text: string) => ipcRenderer.send('clipboard:write', text),

  // projetos: o seletor nativo abre no main; volta só o id
  pickProject: () => inv<string | null>('projects:pick'),
  pinProject: (id: string, on: boolean) => inv<void>('projects:pin', id, on),
  removeProject: (id: string) => inv<void>('projects:remove', id),
  clearRecentProjects: () => inv<void>('projects:clear-recent'),
  setDefaultProject: (id: string | null) => inv<void>('projects:default', id),
  pinSession: (id: string, pinned: boolean) => ipcRenderer.send('session:pin', id, pinned),
  watchSession: (id: string | null) => ipcRenderer.send('session:watch', id),

  // equipes: só função + id de sessão; caminhos ficam no main
  teamBind: (slot: string, sessionId: string | null) => inv<void>('teams:bind', slot, sessionId),
  teamRoster: (rows: import('../shared/teams').RosterRow[]) => inv<void>('teams:roster', rows),
  // equipe manual: preparação (escrita só em CLAUDE.md/.gitignore, com prévia + token)
  manualPick: () => inv<boolean>('manual:pick'),
  manualPreview: (which: 'claude' | 'gitignore') => inv<{ path: string; exists: boolean; diff: string; changes: number; token: string }>('manual:preview', which),
  manualApply: (which: 'claude' | 'gitignore', token: string) => inv<boolean>('manual:apply', which, token),
  manualCopyWorktrees: () => inv<string>('manual:copyWorktrees'),
  manualOpen: (slot: string) => inv<{ ok: boolean; error?: string }>('manual:open', slot),
  teamSet: (p: { name?: string; goal?: string }) => inv<void>('teams:set', p),
  removeAgentTeams: (ids: string[]) => inv<void>('agentTeams:remove', ids), // só do pet; ~/.claude/teams não é tocado

  // chat
  conversations: () => inv<ChatConversation[]>('chat:list'),
  newConversation: (projectId: string | null) => inv<ChatConversation>('chat:new', projectId),
  deleteConversations: (ids: string[]) => inv<void>('chat:delete', ids),
  forgetSessions: (ids: string[]) => inv<void>('session:forget', ids),
  /** Botão direito: menu nativo no main. Resolve 'deleted' se algo foi excluído. */
  contextMenu: (ref: { kind: 'session' | 'project' | 'conv'; id: string }) => inv<'deleted' | null>('ctx:menu', ref),
  send: (convId: string, text: string) => inv<void>('chat:send', convId, text),
  stop: (convId: string) => ipcRenderer.send('chat:stop', convId),
  onChat: (cb: (e: ChatEvent) => void) => on('chat:event', cb),

  // integração / diagnóstico
  previewHooks: () => inv<{ diff: string; changes: number; token: string; settingsPath: string; exists: boolean }>('hooks:preview'),
  installHooks: (token: string) => inv<AppSnapshot['hooks']>('hooks:install', token),
  uninstallHooks: () => inv<AppSnapshot['hooks']>('hooks:uninstall'),
  installStatusBridge: () => inv<AppSnapshot['statusBridge']>('statusline:install'),
  removeStatusBridge: (force = false) => inv<'restored' | 'field' | 'conflict' | 'released' | 'nothing'>('statusline:uninstall', force === true),
  setApiKey: (k: string) => inv<boolean>('key:set', k),
  hasApiKey: () => inv<boolean>('key:has'),
  diagnostics: () => inv<{ logs: string[]; server: unknown; lastEvent: unknown; statusOverrides: string[] }>('diag:get'),
  selfTest: () => inv<{ ok: boolean; detail: string }>('diag:selftest'),
  exportDiagnostics: () => inv<string | null>('diag:export')
}

contextBridge.exposeInMainWorld('pet', api)
export type PetApi = typeof api
