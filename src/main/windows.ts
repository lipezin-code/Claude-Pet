import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { LAPTOP_PAD } from '../shared/sprites'

// Janela do pet: quadro do pet 96x120 a 100% + LAPTOP_PAD colunas (6px cada) à esquerda p/ o notebook de lado,
// proporcional à escala (passos de 10%). Em escalas que não são múltiplos de 1/6 alguns "pixels" da arte ficam 1px
// mais largos que outros (crispEdges mantém as bordas retas).
// petPos salvo = canto do QUADRO do pet (como antes da faixa extra), então posições antigas continuam valendo.
export const snapScale = (s: number) => Math.min(2, Math.max(0.5, Math.round(s * 10) / 10)) // passos de 10%
export function petSize(scale: number) {
  return { w: Math.round((96 + 6 * LAPTOP_PAD) * scale), h: Math.round(120 * scale) }
}
/** Largura (px) da faixa à esquerda do quadro do pet, numa janela de largura w. */
export const petPad = (w: number) => Math.round((w * LAPTOP_PAD) / (16 + LAPTOP_PAD))
export const CHAT_W = 380
export const CHAT_H = 480

const webPreferences = () => ({
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
})

export function loadView(win: BrowserWindow, view: string) {
  const url = process.env['ELECTRON_RENDERER_URL']
  if (url && !app.isPackaged) win.loadURL(`${url}#${view}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
  // nunca navegar para fora nem abrir janelas
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
}

/** Mantém a posição dentro da área útil de algum monitor (multi-monitor / monitor removido). */
export function clampToDisplays(x: number, y: number, w: number, h: number) {
  const d = screen.getDisplayMatching({ x, y, width: w, height: h }).workArea
  return {
    x: Math.min(Math.max(x, d.x), d.x + d.width - w),
    y: Math.min(Math.max(y, d.y), d.y + d.height - h)
  }
}

export function defaultPetPos(w: number, h: number) {
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - w - 24, y: a.y + a.height - h - 8 } // canto inferior direito, junto à barra de tarefas
}

/** pos = canto do quadro do pet (petPos) ou null p/ a posição padrão. */
export function createPet(icon: string, pos: { x: number; y: number } | null, scale: number) {
  const { w, h } = petSize(scale)
  const win0 = pos ? { x: pos.x - petPad(w), y: pos.y } : defaultPetPos(w, h)
  const p = clampToDisplays(win0.x, win0.y, w, h)
  const win = new BrowserWindow({
    width: w, height: h, x: p.x, y: p.y,
    transparent: true, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, focusable: false, show: false, alwaysOnTop: true,
    backgroundColor: '#00000000', title: 'Claude Pet', icon, webPreferences: webPreferences()
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  loadView(win, 'pet')
  win.once('ready-to-show', () => win.showInactive())
  return win
}

export function createChat(icon: string) {
  const win = new BrowserWindow({
    width: CHAT_W, height: CHAT_H, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true, icon, title: 'Claude Pet - Chat',
    backgroundColor: '#00000000', webPreferences: webPreferences()
  })
  win.setAlwaysOnTop(true, 'floating')
  loadView(win, 'chat')
  return win
}

export function createSettings(icon: string) {
  const win = new BrowserWindow({
    width: 760, height: 560, minWidth: 640, minHeight: 480, show: false, autoHideMenuBar: true,
    backgroundColor: '#14161b', icon, title: 'Claude Pet - Configurações', webPreferences: webPreferences()
  })
  loadView(win, 'settings')
  win.once('ready-to-show', () => win.show())
  return win
}

/** Janela Equipes: janela normal (minimizável), como a de Configurações. */
export function createTeams(icon: string) {
  const win = new BrowserWindow({
    width: 900, height: 620, minWidth: 480, minHeight: 360, show: false, autoHideMenuBar: true,
    backgroundColor: '#0b0d12', icon, title: 'Claude Pet - Equipes', webPreferences: webPreferences()
  })
  loadView(win, 'teams')
  win.once('ready-to-show', () => win.show())
  return win
}

/** Posiciona o chat colado ao pet, dentro do monitor onde o pet está. */
export function placeChat(chat: BrowserWindow, pet: BrowserWindow) {
  const pb = pet.getBounds()
  const area = screen.getDisplayMatching(pb).workArea
  const pad = petPad(pb.width)
  let x = pb.x + pad + (pb.width - pad) / 2 - CHAT_W / 2 // centrado no quadro do pet, não na faixa do notebook
  let y = pb.y - CHAT_H - 8 // acima do pet
  if (y < area.y) y = pb.y + pb.height + 8 // sem espaço: abaixo
  x = Math.min(Math.max(x, area.x + 4), area.x + area.width - CHAT_W - 4)
  y = Math.min(Math.max(y, area.y + 4), area.y + area.height - CHAT_H - 4)
  chat.setBounds({ x: Math.round(x), y: Math.round(y), width: CHAT_W, height: CHAT_H })
}

export const MENU_W = 256

/** Janela do menu de contexto customizado: transparente, sem moldura; fecha ao perder o foco. */
export function createMenuWindow(icon: string) {
  const win = new BrowserWindow({
    width: MENU_W, height: 320, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, icon, title: 'Claude Pet - Menu', backgroundColor: '#00000000', webPreferences: webPreferences()
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  loadView(win, 'menu')
  return win
}

/** Ao lado do pet (esquerda; se não couber, direita), alinhado aos "pés" e dentro do monitor. */
export function placeMenu(menu: BrowserWindow, pet: BrowserWindow, h: number) {
  const pb = pet.getBounds()
  const area = screen.getDisplayMatching(pb).workArea
  let x = pb.x + petPad(pb.width) - MENU_W + 8 // à esquerda do quadro do pet (como antes da faixa do notebook)
  if (x < area.x) x = pb.x + pb.width - 8
  x = Math.min(Math.max(x, area.x + 4), area.x + area.width - MENU_W - 4)
  const y = Math.min(Math.max(pb.y + pb.height - h, area.y + 4), area.y + area.height - h - 4)
  menu.setBounds({ x: Math.round(x), y: Math.round(y), width: MENU_W, height: Math.round(h) })
}
