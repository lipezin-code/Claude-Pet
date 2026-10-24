import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CLASSICO } from '../src/shared/skins'
import { DEFAULT_SETTINGS, type AppSnapshot } from '../src/shared/types'
import type { UsageSnapshot } from '../src/shared/usage'
import { UsageBand } from '../src/renderer/UsageBand'

const now = Date.now()
const S = Math.floor(now / 1000)
const full = (o: Partial<{ five: number; week: number; ctx: number; at: number; fiveReset: number }> = {}): UsageSnapshot => ({
  account: { five: { pct: o.five ?? 41, resetsAt: o.fiveReset ?? S + 3600 }, week: { pct: o.week ?? 22, resetsAt: S + 86_400 }, updatedAt: o.at ?? now },
  sessions: { s1: { ctx: { pct: o.ctx ?? 21, size: 1_000_000, tokens: 212_000 }, totals: { read: 2_140_000, creation: 100_000, input: 1000 }, updatedAt: o.at ?? now } }
})
const snap = (usage: UsageSnapshot, expanded = false, bridge: AppSnapshot['statusBridge'] = 'installed'): AppSnapshot => ({
  settings: { ...DEFAULT_SETTINGS, usageBandExpanded: expanded }, skin: CLASSICO, display: { state: 'IDLE', sessionId: 's1', label: '' },
  sessions: [{ id: 's1', cwd: 'C:\\p\\claude-pet', project: 'claude-pet', state: 'IDLE', stateSince: 0, lastEventAt: now, origin: 'cli', liveness: 'active', pinned: false, subagents: 0, log: [] }],
  hooks: { installed: true, events: [], settingsPath: '' }, usage, statusBridge: bridge, cli: { found: true }, projects: [], envMarkers: [], teams: [], agentTeams: [], manualProject: null, version: 't'
})
const html = (s: AppSnapshot) => renderToStaticMarkup(<UsageBand snap={s} />)
const rings = (h: string) => [...h.matchAll(/class="ub-ring (\w+)"[^>]*aria-label="([^"]+)"/g)].map((m) => `${m[2]}:${m[1]}`)

describe('faixa de uso (UI)', () => {
  it('recolhida por padrão: 4 anéis com % e rótulos, seta aria-expanded=false', () => {
    const h = html(snap(full()))
    expect(rings(h)).toEqual(['Contexto:ok', '5 horas:ok', 'Semana:ok', 'Cache:ok'])
    for (const t of ['21%', '41%', '22%', 'Contexto', '5 horas', 'Semana', 'Cache']) expect(h).toContain(t)
    expect(h).toContain('aria-expanded="false"')
    expect(h).toContain('role="meter"')
    expect(h).toContain('aria-valuenow="21"')
  })
  it('expandida: tiles com subtextos prontos e rodapé', () => {
    const h = html(snap(full(), true))
    expect(h).toContain('aria-expanded="true"')
    for (const t of ['212k / 1M', 'Lidos 2,14M', 'Reinicia', 'Sessão claude-pet · atualizado há 0 s']) expect(h).toContain(t)
  })
  it('sem dado: "—" e anel vazio (sem traço de preenchimento), nunca 0%', () => {
    const h = html(snap({ account: null, sessions: {} }, true, 'not_installed'))
    expect(h).not.toContain('ub-fill')
    expect(h).not.toContain('0%')
    expect(h).toContain('—')
    expect(h).toContain('Faixa de uso não instalada')
  })
  it('sem rate_limits: só Contexto e Cache', () => {
    expect(rings(html(snap({ ...full(), account: null })))).toEqual(['Contexto:ok', 'Cache:ok'])
  })
  it('limiares de cor; Cache nunca em alerta', () => {
    expect(rings(html(snap(full({ ctx: 80, five: 95, week: 94.9 }))))).toEqual(['Contexto:warn', '5 horas:crit', 'Semana:warn', 'Cache:ok'])
  })
  it('dado velho: esmaecido e "atualizado há X min"', () => {
    const h = html(snap(full({ at: now - 9 * 60_000 }), true))
    expect(h.match(/ub-tile stale/g)).toHaveLength(4)
    expect(h).toContain('atualizado há 9 min')
  })
  it('reset já passado: "—" no lugar do valor', () => {
    const h = html(snap(full({ five: 88, fiveReset: S - 10 }), true))
    expect(h).not.toContain('88%')
    expect(h).toMatch(/aria-label="5 horas"[^>]*aria-valuetext="5 horas: sem dado"/)
  })
  it('Reduzir movimento desliga a transição', () => {
    const s = snap(full()); s.settings.reduceMotion = true
    expect(html(s)).toContain('class="ub still"')
  })
})
