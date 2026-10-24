// Gera build/icon.png, build/icon.ico e build/tray.png a partir da grade do mascote (sem dependências).
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BODY = [
  '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..', '..OOOOOOOOOOOO..', 'OOOOOOOOOOOOOOOO', 'OOOOOOOOOOOOOOOO', '..OOOOOOOOOOOO..',
  '..DDDDDDDDDDDD..', '..OO.OO..OO.OO..', '..OO.OO..OO.OO..'
]
const COL = { O: [232, 116, 59], D: [181, 83, 42], A: [255, 209, 102], K: [29, 20, 16] }
// olhos
const EYES = [[4, 1], [5, 1], [4, 2], [5, 2], [10, 1], [11, 1], [10, 2], [11, 2]]

function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const cell = Math.floor(size / 16)
  const ox = Math.floor((size - cell * 16) / 2)
  const oy = Math.floor((size - cell * 11) / 2)
  const put = (gx, gy, c) => {
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const i = (((oy + gy * cell + y) * size) + ox + gx * cell + x) * 4
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255
    }
  }
  BODY.forEach((row, gy) => [...row].forEach((ch, gx) => COL[ch] && put(gx, gy, COL[ch])))
  EYES.forEach(([gx, gy]) => put(gx, gy, COL.K))
  return px
}

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
function png(size) {
  const raw = render(size)
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) { rows[y * (size * 4 + 1)] = 0; raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
function ico(sizes) {
  const imgs = sizes.map(png)
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
  let off = 6 + 16 * sizes.length
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16); e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; return e
  })
  return Buffer.concat([head, ...dir, ...imgs])
}
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png(256))
writeFileSync('build/tray.png', png(32))
writeFileSync('build/icon.ico', ico([16, 32, 48, 64, 128, 256]))
console.log('ícones gerados em build/')
