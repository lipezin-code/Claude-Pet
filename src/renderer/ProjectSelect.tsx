import { Pin, PinOff, X } from 'lucide-react'
import type { ProjectItem } from '../shared/types'
import { IconButton } from './ui'
import './projects.css'

const GROUPS: [ProjectItem['group'], string][] = [['pinned', 'Fixados'], ['recent', 'Recentes'], ['session', 'Só nesta execução'], ['auto', 'Automáticos']]

/** Caminho abreviado no meio (o completo vai no title). */
export const shortPath = (p: string, max = 40) => (p.length <= max ? p : `${p.slice(0, 12)}…${p.slice(-(max - 13))}`)

export const sameDir = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/** <option>s agrupados de um <select> nativo (teclado e leitor de tela de graça). Valores = ids. */
export function ProjectOptions({ projects }: { projects: ProjectItem[] }) {
  return <>
    {GROUPS.map(([g, label]) => {
      const items = projects.filter((p) => p.group === g)
      return items.length ? <optgroup key={g} label={label}>{items.map((p) => <option key={p.id} value={p.id} title={p.path}>{p.name} — {shortPath(p.path)}</option>)}</optgroup> : null
    })}
  </>
}

/** Lista própria (não <select> nativo: o dropdown do Windows não aceita botão direito nas opções).
 *  Com onPick, clicar no item escolhe o projeto; sem, só gerencia (fixar/desafixar, remover). */
export function ProjectManager({ projects, onPick, current }: { projects: ProjectItem[]; onPick?: (id: string) => void; current?: string }) {
  const list = onPick ? projects : projects.filter((p) => p.group !== 'auto')
  if (!list.length) return <div className="pj-empty">Nenhum projeto ainda. Use “Escolher pasta…”.</div>
  return <ul className="pj-list" aria-label="Projetos">
    {list.map((p) => (
      <li key={p.id} className={`pj-item ${p.id === current ? 'on' : ''}`} onContextMenu={(e) => { e.preventDefault(); if (p.group !== 'auto') window.pet.contextMenu({ kind: 'project', id: p.id }) }}>
        {onPick
          ? <button type="button" className="pj-txt pj-pick" title={p.path} aria-current={p.id === current} onClick={() => onPick(p.id)}><b>{p.name}</b><small>{shortPath(p.path, 34)}</small></button>
          : <div className="pj-txt" title={p.path}><b>{p.name}</b><small>{shortPath(p.path, 34)}</small></div>}
        {p.group !== 'auto' && <>
          <IconButton sm label={p.group === 'pinned' ? `Desafixar ${p.name}` : `Fixar ${p.name}`} accent={p.group === 'pinned'} onClick={() => window.pet.pinProject(p.id, p.group !== 'pinned').catch((e) => alert(String(e)))}>
            {p.group === 'pinned' ? <PinOff size={13} /> : <Pin size={13} />}
          </IconButton>
          <IconButton sm label={`Remover ${p.name} da lista`} onClick={() => window.pet.removeProject(p.id)}><X size={13} /></IconButton>
        </>}
      </li>
    ))}
  </ul>
}
