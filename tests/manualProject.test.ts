import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentBranch } from '../src/main/gitRead'
import { applyEdit, isWorktree, previewEdit, projectInfo, rulesTemplate, withGitignore, withRules, worktreeCommands, worktreePath } from '../src/main/manualProject'
import { newTeam } from '../src/shared/teams'

const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10)
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pet-mp-'))

describe('regras no CLAUDE.md', () => {
  it('usa a branch detectada, não "main" fixo', () => {
    expect(rulesTemplate('develop')).toContain('nunca trabalhem na develop nem façam merge. Só o líder integra')
    expect(rulesTemplate('develop')).not.toContain(' main ')
  })
  it('cria se não existe; ADICIONA no fim sem apagar; não repete', () => {
    expect(withRules(null, 'main')).toBe(rulesTemplate('main'))
    const cur = '# Projeto' + NL + 'texto meu' + NL
    const out = withRules(cur, 'main')!
    expect(out.startsWith(cur)).toBe(true)
    expect(out).toContain('# Regras da equipe')
    expect(withRules(out, 'main')).toBeNull()
  })
  it('mantém CRLF de quem usa CRLF', () => {
    const out = withRules('# A' + CRLF + 'b' + CRLF, 'main')!
    expect(out.split(CRLF).length - 1).toBe(out.split(NL).length - 1)
  })
})

describe('.gitignore', () => {
  it('acrescenta .equipe/ uma vez só', () => {
    expect(withGitignore(null)).toBe('.equipe/' + NL)
    expect(withGitignore('node_modules')).toBe('node_modules' + NL + '.equipe/' + NL)
    expect(withGitignore('x' + NL + '/.equipe' + NL)).toBeNull()
  })
})

describe('comandos de worktree (só copiados)', () => {
  it('um por agente, só com slugs; pasta do projeto entre aspas simples literais', () => {
    const t = newTeam()
    const cmd = worktreeCommands("C:/Dev/Loja d'Ana", t.agents)
    expect(cmd).toContain("Set-Location -LiteralPath 'C:/Dev/Loja d''Ana'")
    expect(cmd).toContain('git worktree add ..' + String.fromCharCode(92) + 'loja-d-ana-back-end -b back-end')
    expect(cmd).toContain('-b front-end')
    expect(cmd).not.toContain('lider')
  })
  it('slug inválido (arquivo adulterado) não vira comando', () => {
    expect(() => worktreeCommands('C:/p', [{ id: 'a1', slug: 'x; rm -rf /' }])).toThrow()
  })
  it('pasta do worktree = irmã do projeto', () => {
    expect(worktreePath(path.join('C:', 'dev', 'Meu App'), 'back-end')).toBe(path.join('C:', 'dev', 'meu-app-back-end'))
  })
})

describe('gravar só após prévia confirmada', () => {
  it('prévia não grava; token velho é recusado; token certo grava', () => {
    const d = tmp(), f = path.join(d, 'CLAUDE.md')
    fs.writeFileSync(f, '# Meu' + NL)
    const p = previewEdit(f, (c) => withRules(c, 'main'))
    expect(fs.readFileSync(f, 'utf8')).toBe('# Meu' + NL)
    expect(p.changes).toBeGreaterThan(0)
    fs.writeFileSync(f, '# Meu (editado)' + NL)
    expect(() => applyEdit(f, (c) => withRules(c, 'main'), p.token)).toThrow(/mudou depois da prévia/)
    const p2 = previewEdit(f, (c) => withRules(c, 'main'))
    expect(applyEdit(f, (c) => withRules(c, 'main'), p2.token)).toBe(true)
    expect(fs.readFileSync(f, 'utf8')).toContain('# Meu (editado)')
  })
  it('pasta no lugar do arquivo: recusa sem mexer', () => {
    const d = tmp(), f = path.join(d, '.gitignore')
    fs.mkdirSync(f)
    expect(() => previewEdit(f, withGitignore)).toThrow(/não é um arquivo comum/)
  })
})

describe('git (só leitura) e worktree', () => {
  const repo = tmp()
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' })
  git('init', '-q', '-b', 'trunk'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x')
  it('branch atual detectada (não assume main)', async () => {
    expect(await currentBranch(repo)).toBe('trunk')
    expect(await currentBranch(tmp())).toBeNull()
  })
  it('worktree real é reconhecido; pasta comum não', () => {
    const wt = path.join(path.dirname(repo), path.basename(repo) + '-wt')
    git('worktree', 'add', '-q', wt, '-b', 'back')
    expect(isWorktree(wt)).toBe(true)
    expect(isWorktree(repo)).toBe(false)
  })
  it('projectInfo junta tudo', async () => {
    const i = await projectInfo(repo, newTeam().agents)
    expect([i.branch, i.claudeMd, i.gitignore]).toEqual(['trunk', 'missing', 'missing'])
    expect(Object.keys(i.worktrees)).toEqual(['a1', 'a2'])
  })
})

describe('entregas (P4)', async () => {
  const { latestDelivery } = await import('../src/main/gitRead')
  const { deliveryMessage } = await import('../src/shared/manualFlow')
  const repo = tmp()
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }).toString()
  git('init', '-q', '-b', 'trunk'); git('commit', '-q', '--allow-empty', '-m', 'base')
  git('checkout', '-q', '-b', 'back-end')
  git('commit', '-q', '--allow-empty', '-m', 'ENTREGA: rota de pedidos')
  git('commit', '-q', '--allow-empty', '-m', 'ajuste qualquer', '-m', 'ENTREGA: só no corpo não conta')
  git('checkout', '-q', 'trunk')
  it('só o ASSUNTO conta; pega a entrega mais recente da branch', async () => {
    const d = await latestDelivery(repo, 'trunk', 'back-end')
    expect(d?.subject).toBe('ENTREGA: rota de pedidos')
    expect(d?.hash).toMatch(/^[0-9a-f]{40}$/)
  })
  it('branch inexistente ou nome inseguro: null, sem erro', async () => {
    expect(await latestDelivery(repo, 'trunk', 'nao-existe')).toBeNull()
    expect(await latestDelivery(repo, 'trunk', '--output=x')).toBeNull()
  })
  it('texto "Enviar ao líder" com branch, hash e o diff a revisar', () => {
    const t = deliveryMessage({ label: 'Back-end', slug: 'back-end' }, { hash: 'abcdef1234567890abcdef1234567890abcdef12', subject: 'ENTREGA: x' }, 'trunk')
    expect(t).toContain('branch back-end')
    expect(t).toContain('abcdef1234567890abcdef1234567890abcdef12')
    expect(t).toContain('git diff trunk..back-end')
    expect(t).toContain('"aprovado abcdef123456"')
  })
})

describe('ancestralidade (merge / atualizou com a base)', async () => {
  const { isAncestor } = await import('../src/main/gitRead')
  const repo = tmp()
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }).toString().trim()
  git('init', '-q', '-b', 'trunk'); git('commit', '-q', '--allow-empty', '-m', 'base')
  git('checkout', '-q', '-b', 'b'); git('commit', '-q', '--allow-empty', '-m', 'ENTREGA: x')
  const h = git('rev-parse', 'HEAD')
  it('antes do merge: entrega não está na base; contém a base', async () => {
    expect(await isAncestor(repo, h, 'refs/heads/trunk')).toBe(false)
    expect(await isAncestor(repo, 'refs/heads/trunk', h)).toBe(true)
  })
  it('depois do merge: entrega está na base', async () => {
    git('checkout', '-q', 'trunk'); git('merge', '-q', '--no-ff', '-m', 'merge', 'b')
    expect(await isAncestor(repo, h, 'refs/heads/trunk')).toBe(true)
  })
})
