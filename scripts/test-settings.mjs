// Gera um settings.json TEMPORÁRIO só com os hooks do pet, para uso com `claude --settings <arquivo>`.
// Permite testar com uma sessão real sem tocar no settings.json global do usuário.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeHooks } from '../src/shared/hooksConfig.ts'

const out = process.argv[2]
const script = join(process.env.APPDATA, 'ClaudePet', 'hook', 'claude-pet-hook.cjs')
writeFileSync(out, JSON.stringify(mergeHooks({}, process.execPath, script), null, 1))
console.log('ok', script)
