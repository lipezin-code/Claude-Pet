// Move instaladores de versões antigas de release/ para legacy/ (release fica só com a versão do package.json).
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const rel = path.join(root, 'release')
const legacy = path.join(root, 'legacy')
const SETUP = /^Claude Pet Setup (\d+\.\d+\.\d+)\./

for (const f of fs.existsSync(rel) ? fs.readdirSync(rel) : []) {
  const v = SETUP.exec(f)?.[1]
  if (!v || v === version) continue
  fs.mkdirSync(legacy, { recursive: true })
  fs.renameSync(path.join(rel, f), path.join(legacy, f))
  console.log(`legacy/${f}`)
}
