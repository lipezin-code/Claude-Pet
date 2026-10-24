import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { SESSION_ID_RE, cleanEnv } from './claudeCli'

export type Chunk =
  | { kind: 'delta'; text: string }
  | { kind: 'session'; id: string }
  | { kind: 'result'; isError: boolean; text?: string }

/** Converte uma mensagem do stream (CLI stream-json ou SDK, mesmo formato) em chunks da UI. */
export function mapMessage(m: any): Chunk[] {
  if (!m || typeof m !== 'object') return []
  if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') return [{ kind: 'session', id: m.session_id }]
  if (m.type === 'stream_event' && !m.parent_tool_use_id) {
    const d = m.event?.type === 'content_block_delta' ? m.event.delta : null
    if (d?.type === 'text_delta' && d.text) return [{ kind: 'delta', text: d.text }]
    return []
  }
  if (m.type === 'result') {
    const isError = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success')
    const text = isError ? (Array.isArray(m.errors) && m.errors.length ? m.errors.join('\n') : String(m.result ?? m.subtype ?? 'erro')) : undefined
    const out: Chunk[] = []
    if (typeof m.session_id === 'string') out.push({ kind: 'session', id: m.session_id })
    out.push({ kind: 'result', isError, text })
    return out
  }
  return []
}

/** Mensagem `assistant` completa (fallback quando não vieram deltas). */
export function assistantText(m: any): string {
  if (m?.type !== 'assistant' || m.parent_tool_use_id) return ''
  return (m.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
}

export interface RunOpts {
  prompt: string
  cwd: string
  resume?: string
  model?: string
  signal: AbortSignal
  onChunk: (c: Chunk) => void
}

function pump(m: any, o: RunOpts, st: { gotDelta: boolean; finished: boolean }) {
  for (const c of mapMessage(m)) {
    if (c.kind === 'delta') st.gotDelta = true
    if (c.kind === 'result') st.finished = true
    o.onChunk(c)
  }
  if (!st.gotDelta) {
    const t = assistantText(m)
    if (t) { st.gotDelta = true; o.onChunk({ kind: 'delta', text: t }) }
  }
}

/** Chat é conversa (igual Claude Desktop): sem ferramentas nem MCP, nunca lê/edita/apaga arquivo nem roda comando. */
export const CHAT_PROMPT = 'Você está no mini chat do Claude Pet: uma conversa de texto, sem acesso a arquivos, terminal ou ferramentas. Não diga que vai executar, editar ou apagar algo; se pedirem uma ação, explique em texto como fazer.'

/** Motor CLI: usa o `claude` instalado e o login do próprio usuário (sem tocar em credenciais). */
export function runCli(claudePath: string, o: RunOpts, pre: string[] = []): Promise<void> {
  return new Promise((resolve) => {
    const args = [...pre, '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--strict-mcp-config', '--append-system-prompt', CHAT_PROMPT]
    if (o.resume) { if (!SESSION_ID_RE.test(o.resume)) { o.onChunk({ kind: 'result', isError: true, text: 'ID de sessão inválido' }); return resolve() } args.push('--resume', o.resume) }
    if (o.model) args.push('--model', o.model)
    let child: ReturnType<typeof spawn>
    try { child = spawn(claudePath, args, { cwd: o.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv() }) } catch (e: any) {
      o.onChunk({ kind: 'result', isError: true, text: `Falha ao iniciar claude: ${e.message}` }); return resolve()
    }
    const st = { gotDelta: false, finished: false }
    let err = ''
    child.stderr!.on('data', (d) => { err = (err + d).slice(-2000) })
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try { pump(JSON.parse(line), o, st) } catch { /* linha não-JSON */ }
    })
    const abort = () => child.kill()
    o.signal.addEventListener('abort', abort, { once: true })
    child.on('error', (e) => { o.onChunk({ kind: 'result', isError: true, text: `Falha ao iniciar claude: ${e.message}` }); st.finished = true; resolve() })
    child.on('close', (code) => {
      o.signal.removeEventListener('abort', abort)
      if (!st.finished) o.onChunk({ kind: 'result', isError: !o.signal.aborted, text: o.signal.aborted ? undefined : (err.trim() || `claude saiu com código ${code}`) })
      resolve()
    })
    child.stdin!.on('error', () => {})
    child.stdin!.end(o.prompt) // prompt via stdin: sem limite de argv, sem injeção
  })
}

/** Motor SDK: exige ANTHROPIC_API_KEY (política Anthropic p/ apps de terceiros). */
export async function runSdk(apiKey: string, o: RunOpts, claudePath?: string): Promise<void> {
  const st = { gotDelta: false, finished: false }
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const ac = new AbortController()
    o.signal.addEventListener('abort', () => ac.abort(), { once: true })
    const q = query({
      prompt: o.prompt,
      options: {
        cwd: o.cwd, resume: o.resume, abortController: ac, includePartialMessages: true,
        model: o.model || undefined, tools: [], mcpServers: {}, strictMcpConfig: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: CHAT_PROMPT },
        pathToClaudeCodeExecutable: claudePath,
        env: { ...cleanEnv(), ANTHROPIC_API_KEY: apiKey }
      } as any
    })
    for await (const m of q) pump(m, o, st)
  } catch (e: any) {
    if (!o.signal.aborted) o.onChunk({ kind: 'result', isError: true, text: authHint(String(e?.message ?? e)) })
    st.finished = true
  }
  if (!st.finished && !o.signal.aborted) o.onChunk({ kind: 'result', isError: false })
}

/** Lista sem as conversas excluídas; conversa com resposta em andamento fica. */
export function dropConvs<T extends { id: string }>(list: T[], ids: string[], running: { has(id: string): boolean }): T[] {
  const del = new Set(ids.filter((id) => !running.has(id)))
  return list.filter((c) => !del.has(c.id))
}

export function authHint(msg: string): string {
  return /api key|authentication|401|login/i.test(msg) ? `Erro de autenticação. Verifique a chave de API em Configurações > Chat.\n${msg}` : msg
}
