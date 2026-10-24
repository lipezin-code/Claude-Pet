import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Md } from '../src/renderer/Markdown'

const html = (t: string) => renderToStaticMarkup(<Md text={t} />)

describe('Markdown do chat continua sanitizado', () => {
  it('HTML bruto não vira elemento', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://x"></iframe>')
    expect(out).not.toMatch(/<(script|img|iframe)[\s>]/i) // texto escapado (&lt;) é inofensivo
    expect(out).not.toMatch(/<[a-z][^>]*\son\w+=/i)
  })
  it('links nunca viram <a> nem carregam javascript:', () => {
    const out = html('[clique](javascript:alert(1)) e [ok](https://example.com) e <a href="javascript:alert(1)">x</a>')
    expect(out).not.toMatch(/<a[\s>]/i)
    expect(out).not.toMatch(/<[a-z][^>]*\s(href|src)=/i) // nenhuma tag real com href/src
    expect(out).not.toMatch(/<link/i)
  })
  it('imagens markdown não carregam nada da rede', () => {
    const out = html('![x](https://evil.example/p.png)')
    expect(out).not.toMatch(/<img|<link|evil\.example/i)
    expect(out).toContain('[imagem: x]')
  })
  it('código formatado funciona (cabeçalho com linguagem)', () => {
    const out = html('```ts\nconst a = 1\n```')
    expect(out).toContain('cx-code')
    expect(out).toContain('ts')
    expect(out).toContain('const a = 1')
  })
})
