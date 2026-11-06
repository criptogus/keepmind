// Generates build/icon.png — a neural-synapse app icon (1024x1024).
// Pure Node: rasterizes nodes+edges with glow onto a dark rounded square,
// encodes PNG manually (zlib). Run: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 1024
const px = new Float32Array(S * S * 3) // rgb float for glow accumulation

const cx = S / 2, cy = S / 2

// background: near-black with subtle radial vignette
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 3
    const dx = (x - cx) / (S * 0.55), dy = (y - cy) / (S * 0.55)
    const d = Math.sqrt(dx * dx + dy * dy)
    const base = 3 + 14 * Math.max(0, 1 - d) // subtle center glow
    px[i] = base * 0.25; px[i + 1] = base * 0.45; px[i + 2] = base
  }
}

function addDot(x, y, r, color, intensity = 1) {
  const x0 = Math.max(0, Math.floor(x - r * 3)), x1 = Math.min(S - 1, Math.ceil(x + r * 3))
  const y0 = Math.max(0, Math.floor(y - r * 3)), y1 = Math.min(S - 1, Math.ceil(y + r * 3))
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.hypot(xx - x, yy - y) / r
      if (d > 3) continue
      const g = Math.exp(-d * d * 1.6) * intensity
      const i = (yy * S + xx) * 3
      px[i] += color[0] * g; px[i + 1] += color[1] * g; px[i + 2] += color[2] * g
    }
  }
}

function addLine(x0, y0, x1, y1, color, width = 2.2, intensity = 0.5) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.ceil(len)
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    addDot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width, color, intensity / Math.sqrt(len / 60 + 1))
  }
}

// deterministic pseudo-random
let seed = 42
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const CYAN = [60, 200, 240], LIME = [140, 220, 60], VIOLET = [150, 120, 250], AMBER = [250, 200, 80]
const palette = [CYAN, CYAN, CYAN, LIME, VIOLET, AMBER]

// two hemispheres of neurons
const nodes = []
for (const side of [-1, 1]) {
  const count = 46
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const r = 0.16 + rand() * 0.3
    // brain-ish blob: wider at bottom, fissure at center
    let x = cx + side * (30 + r * S * 0.28 * (0.7 + 0.5 * Math.sin(a)))
    let y = cy + (rand() - 0.42) * S * 0.52
    if (Math.abs(x - cx) < 46) x = cx + side * 46 // keep out of fissure
    nodes.push({ x, y, c: palette[Math.floor(rand() * palette.length)], r: 2.5 + rand() * 5 })
  }
}
// central core node
nodes.push({ x: cx, y: cy, c: [220, 245, 255], r: 14 })

// edges: connect each node to 2 nearest same-side neighbors + a few cross links
for (let i = 0; i < nodes.length - 1; i++) {
  const a = nodes[i]
  const dists = nodes
    .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
    .filter(o => o.j !== i && Math.sign(nodes[o.j].x - cx) === Math.sign(a.x - cx))
    .sort((p, q) => p.d - q.d)
  for (const { j } of dists.slice(0, 2)) {
    if (nodes[j].x === cx || a.x === cx) continue
    addLine(a.x, a.y, nodes[j].x, nodes[j].y, a.c, 2, 0.16)
  }
}
// core spokes
for (const n of nodes.slice(0, -1)) {
  if (Math.hypot(n.x - cx, n.y - cy) < S * 0.34) addLine(cx, cy, n.x, n.y, [80, 200, 235], 1.6, 0.1)
}
// draw nodes on top
for (const n of nodes) addDot(n.x, n.y, n.r, n.c, 1)

// rounded-square mask (macOS-style squircle approx via superellipse)
const alpha = new Uint8Array(S * S)
const rad = S * 0.22
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    // distance to rounded rect edge
    const qx = Math.abs(x - cx) - (S / 2 - rad)
    const qy = Math.abs(y - cy) - (S / 2 - rad)
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0)
    const d = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad
    alpha[y * S + x] = d <= 0 ? 255 : Math.max(0, Math.min(255, (2 - d / (S * 0.004)) * 255))
  }
}

// tone map + write PNG
const out = Buffer.alloc(S * S * 4)
for (let i = 0; i < S * S; i++) {
  const v = i * 3, o = i * 4
  const r = 1 - Math.exp(-px[v] / 90), g = 1 - Math.exp(-px[v + 1] / 90), b = 1 - Math.exp(-px[v + 2] / 90)
  out[o] = Math.min(255, r * 255); out[o + 1] = Math.min(255, g * 255); out[o + 2] = Math.min(255, b * 255)
  out[o + 3] = alpha[i]
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(td) >>> 0)
  return Buffer.concat([len, td, crcBuf])
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
// scanlines with filter byte 0
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  out.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.png'), png)
console.log('wrote build/icon.png', png.length, 'bytes')
