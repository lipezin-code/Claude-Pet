import { Bell, Check, ChevronLeft, ChevronRight, EyeOff, FolderOpen, Info, Layers, LogOut, Maximize2, MessageSquare, Pin, Power, Settings as Cog, Smile, Terminal, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuNode } from '../main/menuModel'
import './contextMenu.css'

// ícone por prefixo do rótulo (o modelo vem do mesmo template do menu nativo)
const ICONS: [string, LucideIcon][] = [
  ['Abrir mini chat', MessageSquare], ['Equipes', Users], ['Sessões ativas', Layers], ['Abrir Claude Code', Terminal], ['Selecionar projeto', FolderOpen],
  ['Alterar mascote', Smile], ['Tamanho do pet', Maximize2], ['Sempre visível', Pin], ['Sons e notificações', Bell],
  ['Iniciar com Windows', Power], ['Configurações', Cog], ['Ocultar pet', EyeOff], ['Sobre', Info], ['Sair', LogOut]
]
const iconFor = (label: string) => ICONS.find(([p]) => label.startsWith(p))?.[1]

export function ContextMenu({ initial }: { initial?: MenuNode[] }) {
  const [model, setModel] = useState<MenuNode[]>(initial ?? [])
  const [stack, setStack] = useState<MenuNode[]>([]) // submenu aberto (drill-down)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.pet.menuModel().then((m) => { setModel(m); setStack([]) }) // pull ao montar (o push pode chegar antes do snapshot)
    return window.pet.onMenu((m) => { setModel(m); setStack([]) })
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') (stack.length ? setStack([]) : window.pet.menuClose()) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [stack.length])
  // informa a altura real; o main posiciona e só então mostra a janela
  useLayoutEffect(() => {
    if (!model.length || !box.current) return
    window.pet.menuSize(Math.ceil(box.current.getBoundingClientRect().height) + 20)
  }, [model, stack])

  const cur = stack.length ? stack[stack.length - 1].children! : model
  const act = (n: MenuNode) => {
    if (!n.enabled) return
    if (n.type === 'sub') setStack([...stack, n]); else window.pet.menuClick(n.id)
  }

  return (
    <div className="ctx-wrap">
      <div className="ctx ui-card" role="menu" ref={box}>
        {stack.length > 0 && (
          <button type="button" className="ctx-back" onClick={() => setStack(stack.slice(0, -1))}><ChevronLeft size={15} />{stack[stack.length - 1].label}</button>
        )}
        {cur.map((n, i) => {
          if (n.type === 'sep') return <hr key={n.id} />
          const Icon = stack.length ? undefined : iconFor(n.label)
          const info = !n.enabled && n.type === 'item'
          const title = info && i === 0 && !stack.length // "Claude Pet" no topo: cabeçalho, não item apagado
          return (
            <button key={n.id} type="button" role={n.type === 'check' ? 'menuitemcheckbox' : n.type === 'radio' ? 'menuitemradio' : 'menuitem'}
              aria-checked={n.type === 'check' || n.type === 'radio' ? !!n.checked : undefined}
              className={`ctx-item ${info ? 'info' : ''} ${title ? 'title' : ''} ${n.label === 'Sair' ? 'danger' : ''}`} disabled={!n.enabled} onClick={() => act(n)}>
              <span className="ic">{Icon && <Icon size={15} />}</span>
              <span className="lb">{n.label}{n.sublabel && <small>{n.sublabel}</small>}</span>
              {n.type === 'sub' && <ChevronRight size={14} className="end" />}
              {(n.type === 'check' || n.type === 'radio') && n.checked && <Check size={14} className="end on" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
