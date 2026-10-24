/**
 * Diff de linhas (LCS) para a prévia do settings.json: só os trechos alterados, com `ctx` linhas de contexto.
 * Prefixos: "+ " entra, "- " sai, "  " igual; "…" separa trechos. Sem dependência nova.
 * ponytail: LCS O(n·m); settings.json tem centenas de linhas. Acima de MAX_CELLS cai no resumo "tudo saiu/tudo entra".
 */
const MAX_CELLS = 4_000_000

export function lineDiff(before: string, after: string, ctx = 2): { text: string; changes: number } {
  const a = before.split('\n'), b = after.split('\n')
  if (before === after) return { text: '', changes: 0 }
  let ops: [' ' | '-' | '+', string][]
  if (a.length * b.length > MAX_CELLS) ops = [...a.map((l): ['-', string] => ['-', l]), ...b.map((l): ['+', string] => ['+', l])]
  else {
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    ops = []
    let i = 0, j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++ }
      else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) ops.push(['-', a[i++]]) // "-" antes do "+"
      else ops.push(['+', b[j++]])
    }
  }
  const keep = ops.map((_, k) => ops.slice(Math.max(0, k - ctx), k + ctx + 1).some(([o]) => o !== ' '))
  const out: string[] = []
  ops.forEach(([o, l], k) => {
    if (!keep[k]) return
    if (k > 0 && !keep[k - 1]) out.push('…') // linhas iguais omitidas antes deste trecho
    out.push(`${o} ${l}`)
  })
  if (!keep[ops.length - 1]) out.push('…')
  return { text: out.join('\n'), changes: ops.filter(([o]) => o !== ' ').length }
}
