import type { MenuItemConstructorOptions } from 'electron'

/** Modelo serializável do menu de contexto (vai para o renderer; handlers ficam só no main). */
export interface MenuNode {
  id: string
  label: string
  sublabel?: string
  type: 'item' | 'sep' | 'check' | 'radio' | 'sub'
  checked?: boolean
  enabled: boolean
  children?: MenuNode[]
}

/** Converte o mesmo template do menu nativo (fonte única) em nós com id + registra os handlers. */
export function serializeMenu(tpl: MenuItemConstructorOptions[], handlers: Map<string, () => void>, seed = { n: 0 }): MenuNode[] {
  return tpl.map((it): MenuNode => {
    const id = `m${seed.n++}`
    if (it.type === 'separator') return { id, label: '', type: 'sep', enabled: false }
    const enabled = it.enabled !== false
    if (it.submenu) {
      const sub = Array.isArray(it.submenu) ? it.submenu : []
      return { id, label: String(it.label ?? ''), type: 'sub', enabled, children: serializeMenu(sub, handlers, seed) }
    }
    const type = it.type === 'checkbox' ? 'check' : it.type === 'radio' ? 'radio' : 'item'
    if (enabled && it.click) {
      const next = type === 'check' ? !it.checked : true
      handlers.set(id, () => { void it.click!({ checked: next } as never, undefined, {} as never) })
    }
    return { id, label: String(it.label ?? ''), sublabel: it.sublabel, type, checked: !!it.checked, enabled: enabled && !!it.click }
  })
}
