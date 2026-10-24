import { describe, expect, it } from 'vitest'
import { CLAUDE_MARKERS, cleanEnv, markerNames } from '../src/main/claudeCli'

const keep = {
  PATH: 'C:\\bin', ANTHROPIC_API_KEY: 'sk-ant-segredo123', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_EFFORT: 'high',
  HTTPS_PROXY: 'http://proxy:8080', CLAUDE_PET_DATA_DIR: 'C:\\tmp\\pet', CLAUDE_CODE_FORCE_SESSION_PERSISTENCE: '1'
}
const dirty = () => ({ ...keep, ...Object.fromEntries(CLAUDE_MARKERS.map((k) => [k, `valor-${k}`])), claudecode: '1' })

describe('cleanEnv', () => {
  it('remove só os marcadores (inclusive grafia minúscula) e preserva o resto', () => {
    expect(cleanEnv(dirty())).toEqual(keep)
  })
  it('não altera o ambiente de entrada', () => {
    const e = dirty(); const before = { ...e }
    cleanEnv(e)
    expect(e).toEqual(before)
  })
})

describe('markerNames', () => {
  it('devolve só nomes, nunca valores', () => {
    const names = markerNames(dirty())
    expect(names).toEqual([...CLAUDE_MARKERS, 'claudecode'].sort())
    const out = JSON.stringify(names)
    expect(out).not.toContain('valor-')
    expect(out).not.toContain('segredo')
  })
  it('ambiente limpo = lista vazia', () => {
    expect(markerNames(keep)).toEqual([])
  })
})

describe('terminalEnv (modo equipe)', async () => {
  const { terminalEnv } = await import('../src/main/claudeCli')
  it('normal: igual ao cleanEnv, sem Agent Teams', () => {
    expect(terminalEnv({}, dirty())).toEqual(keep)
  })
  it('modo equipe: só acrescenta a variável, sem marcadores do Claude', () => {
    const e = terminalEnv({ agentTeams: true }, dirty())
    expect(e).toEqual({ ...keep, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' })
  })
})

describe('OpenRef: pasta do usuário / escolher pasta', async () => {
  const { OpenRef } = await import('../src/main/projects')
  it('aceita só os formatos fixos', () => {
    expect(OpenRef.safeParse({ home: true }).success).toBe(true)
    expect(OpenRef.safeParse({ pick: true }).success).toBe(true)
    expect(OpenRef.safeParse({ home: false }).success).toBe(false)
    expect(OpenRef.safeParse({ pick: true, cwd: 'C:/x' }).success).toBe(false)
    expect(OpenRef.safeParse({ home: 'C:/Windows' }).success).toBe(false)
  })
})

describe('desktopLaunch (Claude Desktop)', async () => {
  const { desktopLaunch } = await import('../src/main/claudeCli')
  const has = (...ok: string[]) => (p: string) => ok.some((x) => p.endsWith(x))
  it('instalador antigo: abre o exe', () => {
    expect(desktopLaunch('L', has('claude.exe'))?.args).toEqual([])
  })
  it('Microsoft Store: abre pelo AppUserModelID via explorer.exe', () => {
    expect(desktopLaunch('L', has('Claude_pzs8sxrjxfjjc'))).toEqual({ file: 'explorer.exe', args: ['shell:AppsFolder' + String.fromCharCode(92) + 'Claude_pzs8sxrjxfjjc!Claude'] })
  })
  it('nenhum: null', () => expect(desktopLaunch('L', () => false)).toBeNull())
})
