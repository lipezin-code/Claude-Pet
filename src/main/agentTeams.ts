import fs from 'node:fs'
import path from 'node:path'
import { parseTeamConfig, type AgentTeamMember } from '../shared/agentTeams'

// SOMENTE LEITURA em ~/.claude/teams (o Claude Code é o dono; nunca escrevemos lá).
const MAX_CONFIG = 256 * 1024
const DIR_NAME = /^[A-Za-z0-9_-]{1,80}$/

const warned = new Set<string>() // avisa 1x por pasta (a leitura roda a cada 5 s)

export type FoundTeam = { id: string; leadSessionId: string; members: AgentTeamMember[] }

export function readAgentTeams(teamsDir: string, log: (m: string) => void): FoundTeam[] {
  let names: string[]
  try { names = fs.readdirSync(teamsDir) } catch { return [] } // pasta ausente = recurso desligado
  const out: FoundTeam[] = []
  for (const n of names.slice(0, 50)) {
    if (!DIR_NAME.test(n)) continue
    const f = path.join(teamsDir, n, 'config.json')
    try {
      const st = fs.lstatSync(f)
      if (!st.isFile() || st.size > MAX_CONFIG) continue // link simbólico/arquivo enorme: ignora
      const t = parseTeamConfig(fs.readFileSync(f, 'utf8'), n)
      if (t) out.push(t)
      else if (!warned.has(n)) { warned.add(n); log(`agent teams: ${n}/config.json ilegível ou sem leadSessionId; ignorado`) }
    } catch { /* sendo escrito/apagado agora: tenta de novo no próximo ciclo */ }
  }
  return out
}

// tipos de subagente embutidos no Claude Code (um membro com esse nome é ambíguo)
const BUILTIN = ['general-purpose', 'explore', 'plan', 'statusline-setup', 'claude-code-guide', 'output-style-setup', 'fork']

/** Tipos de subagente conhecidos: embutidos + definições em ~/.claude/agents e <pasta do líder>/.claude/agents (só leitura). */
export function knownSubagentTypes(claudeDir: string, leadCwd?: string): Set<string> {
  const out = new Set(BUILTIN)
  for (const dir of [path.join(claudeDir, 'agents'), leadCwd ? path.join(leadCwd, '.claude', 'agents') : null]) {
    if (!dir) continue
    let files: string[]
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).slice(0, 200) } catch { continue }
    for (const f of files) {
      out.add(f.slice(0, -3).toLowerCase())
      try { // `name:` do frontmatter pode diferir do nome do arquivo
        const head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 2000)
        const m = /^name:\s*["']?([^"'\r\n]+)/m.exec(head)
        if (m) out.add(m[1].trim().toLowerCase())
      } catch { /* ignora */ }
    }
  }
  return out
}
