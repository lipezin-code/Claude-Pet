// Gera docs/skins-preview.png a partir do build (rota #preview-skins), sem servidor de dev e sem tocar no app real.
// Uso: npm run build && npx electron scripts/skins-preview.mjs
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
app.setPath('userData', path.join(app.getPath('temp'), 'claude-pet-preview')) // não usa %APPDATA%\ClaudePet
app.whenReady().then(run).catch((e) => { console.error('falhou:', e.message); app.exit(1) }) // nunca fica pendurado

async function run() {
  const win = new BrowserWindow({ show: false, width: 1100, height: 600, enableLargerThanScreen: true, useContentSize: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } })
  await win.loadFile(path.join(root, 'out/renderer/index.html'), { hash: 'preview-skins' })
  await new Promise((r) => setTimeout(r, 500))
  const box = await win.webContents.executeJavaScript('(() => { const r = document.getElementById("sheet").getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) } })()')
  win.setContentSize(box.width, box.height) // offscreen: pode passar da altura do monitor
  await new Promise((r) => setTimeout(r, 800))
  const img = await win.webContents.capturePage({ x: 0, y: 0, ...box })
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(root, 'docs/skins-preview.png'), img.toPNG())
  console.log('docs/skins-preview.png', img.getSize())
  app.quit()
}
