import fs from 'node:fs'
import path from 'node:path'

/** JSON em disco com escrita atômica (tmp + rename). */
export class JsonStore<T> {
  constructor(private file: string, private fallback: T) {}
  exists() { return fs.existsSync(this.file) }
  read(): T {
    try { return { ...this.fallback, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) } } catch { return structuredClone(this.fallback) }
  }
  write(v: T) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(v, null, 1), 'utf8')
    fs.renameSync(tmp, this.file)
  }
}

/** Remove segredos óbvios de texto de log. */
export function redact(s: string): string {
  return s
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***')
    .replace(/("?(?:token|api[_-]?key|authorization)"?\s*[:=]\s*"?)[^\s",}]{6,}/gi, '$1***')
}
