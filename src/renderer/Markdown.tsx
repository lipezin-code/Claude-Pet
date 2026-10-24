import { Check, Copy } from 'lucide-react'
import { Children, isValidElement, useState } from 'react'
import ReactMarkdown from 'react-markdown'

// SEGURANÇA: sem rehype-raw => HTML bruto nunca vira elemento; links viram <span> (nada navega,
// nada de javascript:). Não adicionar plugins que reabilitem HTML sem revisar. Coberto por tests/markdown.test.tsx.
const textOf = (n: React.ReactNode): string =>
  Children.toArray(n).map((c) => (typeof c === 'string' ? c : isValidElement(c) ? textOf((c.props as { children?: React.ReactNode }).children) : '')).join('')

export function CopyButton({ text, label, className = 'ui-btn sm' }: { text: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" className={className} title="Copiar" aria-label="Copiar" onClick={() => { window.pet.copy(text); setOk(true); setTimeout(() => setOk(false), 1200) }}>
      {ok ? <Check size={13} /> : <Copy size={13} />}{label && (ok ? 'Copiado' : label)}
    </button>
  )
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const child = Children.toArray(children)[0]
  const cls = isValidElement(child) ? String((child.props as { className?: string }).className ?? '') : ''
  const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? 'código'
  return (
    <div className="cx-code">
      <div className="cx-code-hdr"><span>{lang}</span><CopyButton text={textOf(children).replace(/\n$/, '')} label="Copiar" /></div>
      <pre>{children}</pre>
    </div>
  )
}

export function Md({ text }: { text: string }) {
  return (
    <ReactMarkdown components={{ pre: ({ children }) => <CodeBlock>{children}</CodeBlock>, a: ({ children }) => <span className="cx-link">{children}</span>,
        img: ({ alt }) => <span className="cx-link">{alt ? `[imagem: ${alt}]` : '[imagem]'}</span> // nunca carrega imagem remota
      }}>
      {text}
    </ReactMarkdown>
  )
}
