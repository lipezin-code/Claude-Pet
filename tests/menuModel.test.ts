import { describe, expect, it, vi } from 'vitest'
import { serializeMenu } from '../src/main/menuModel'

describe('serializeMenu', () => {
  it('mantém estrutura, tipos e submenus; informativos ficam desabilitados', () => {
    const h = new Map<string, () => void>()
    const m = serializeMenu([
      { label: 'Título', enabled: false },
      { type: 'separator' },
      { label: 'Abrir', click: () => {} },
      { label: 'Sub', submenu: [{ label: 'A', type: 'radio', checked: true, click: () => {} }, { label: 'Nenhuma', enabled: false }] }
    ], h)
    expect(m.map((n) => n.type)).toEqual(['item', 'sep', 'item', 'sub'])
    expect(m[0].enabled).toBe(false)
    expect(m[3].children![0]).toMatchObject({ type: 'radio', checked: true, enabled: true })
    expect(m[3].children![1].enabled).toBe(false)
    expect(h.size).toBe(2) // só itens clicáveis
    expect(new Set(JSON.stringify(m).match(/"id":"m\d+"/g)).size).toBe(6) // ids únicos
  })
  it('checkbox entrega o valor invertido ao handler (como o menu nativo)', () => {
    const click = vi.fn()
    const h = new Map<string, () => void>()
    const m = serializeMenu([{ label: 'Sons', type: 'checkbox', checked: true, click }], h)
    h.get(m[0].id)!()
    expect(click.mock.calls[0][0]).toEqual({ checked: false })
  })
  it('o modelo é serializável (sem funções)', () => {
    const m = serializeMenu([{ label: 'X', click: () => {} }], new Map())
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })
})
