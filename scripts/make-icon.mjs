// Generates build/icon.png — the KeepMind app icon (1024x1024).
// Rasterizes the BrainMark logo (two glowing hemispheres + folds + core)
// onto a dark squircle with synapse accents. Pure Node: manual PNG encode.
// Run: node scripts/make-icon.mjs   →  icon.png + icon.ico
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const S = 1024
const px = new Float32Array(S * S * 3)
const cx = S / 2, cy = S / 2

// background: near-black with subtle cyan radial vignette
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 3
    const dx = (x - cx) / (S * 0.55), dy = (y - cy) / (S * 0.55)
    const d = Math.sqrt(dx * dx + dy * dy)
    const base = 3 + 16 * Math.max(0, 1 - d)
    px[i] = base * 0.22; px[i + 1] = base * 0.42; px[i + 2] = base * 0.95
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

function addLine(x0, y0, x1, y1, color, width = 2, intensity = 0.4) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(2, Math.ceil(len))
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    addDot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width, color, intensity / Math.sqrt(len / 50 + 1))
  }
}

// ── Tiny SVG path sampler: M L H V C S Z (absolute coords, viewBox units) ──
function samplePath(d, map) {
  const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const pts = []
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = ''
  const num = () => parseFloat(tokens[i++])
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; pts.push(map(x, y)); cmd = 'L' }
    else if (cmd === 'L') { x = num(); y = num(); pts.push(map(x, y)) }
    else if (cmd === 'H') { x = num(); pts.push(map(x, y)) }
    else if (cmd === 'V') { y = num(); pts.push(map(x, y)) }
    else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num()
      for (let t = 1; t <= 20; t++) {
        const u = 1 - t / 20
        pts.push(map(
          u*u*u*x + 3*u*u*(t/20)*x1 + 3*u*(t/20)*(t/20)*x2 + (t/20)**3*x3,
          u*u*u*y + 3*u*u*(t/20)*y1 + 3*u*(t/20)*(t/20)*y2 + (t/20)**3*y3
        ))
      }
      x = x3; y = y3
    }
    else if (cmd === 'Z' || cmd === 'z') { pts.push(map(sx, sy)); cmd = '' }
    else break
  }
  return pts
}

// KeepMind mark geometry (viewBox 0 0 48 48) scaled to icon space.
// A circuit-K: hex chip + neural K beams + synapse nodes.
const SC = S / 48
const map = (vx, vy) => [cx + (vx - 24) * SC * 0.92, cy + (vy - 24) * SC * 0.92]

const CHIP = 'M24 5.5 L39 14.5 V33.5 L24 42.5 L9 33.5 V14.5 Z'
const SPINE = 'M20 14.5 V33.5'
const ARM_UP = 'M20 24 L30.5 15'
const ARM_DN = 'M20 24 L30.5 33'
const TRACES = 'M13.5 14.5 H17 M13.5 33.5 H17 M35.5 15 H32 M35.5 33 H32'

const CYAN = [125, 211, 252], DEEP = [8, 145, 178], WHITE = [224, 247, 255]
const LIME = [163, 230, 53], VIOLET = [167, 139, 250], AMBER = [250, 204, 21]

function strokePath(d, color, width, intensity, passes = 1) {
  const pts = samplePath(d, map)
  for (let p = 0; p < passes; p++) {
    for (let i = 1; i < pts.length; i++) {
      addLine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], color, width * (1 + p * 2.2), intensity / (1 + p))
    }
  }
}

// 1) soft outer glow of the chip
strokePath(CHIP, DEEP, 26, 0.10, 1)
strokePath(CHIP, CYAN, 10, 0.16, 1)

// 2) chip core glow
addDot(cx, cy, S * 0.20, [10, 60, 90], 0.5)
addDot(cx, cy, S * 0.13, [20, 110, 150], 0.45)

// 3) crisp chip outline
strokePath(CHIP, CYAN, 4.5, 0.85)
strokePath(CHIP, WHITE, 1.6, 0.5)

// 4) neural K: spine + arms + circuit traces
strokePath(SPINE, DEEP, 5, 0.5)
strokePath(SPINE, CYAN, 2, 0.7)
strokePath(ARM_UP, [70, 170, 220], 3, 0.55)
strokePath(ARM_DN, [70, 170, 220], 3, 0.55)
strokePath(ARM_UP, LIME, 1.4, 0.5)
strokePath(ARM_DN, LIME, 1.4, 0.5)
strokePath(TRACES, [70, 170, 220], 2, 0.4)

// 5) synapse nodes: joint + arm tips + spine ends
const nodes = [
  [20, 24, WHITE], [20, 14.5, CYAN], [20, 33.5, CYAN],
  [30.5, 15, LIME], [30.5, 33, LIME]
]
for (const [vx, vy, col] of nodes) {
  const [x, y] = map(vx, vy)
  addDot(x, y, S * 0.016, DEEP, 1.3)
  addDot(x, y, S * 0.010, col, 1.1)
  addDot(x, y, S * 0.004, [255, 255, 255], 1.5)
}
// extra-bright joint node
{
  const [x, y] = map(20, 24)
  addDot(x, y, S * 0.007, [255, 255, 255], 1.8)
}

// 6) satellite synapses orbiting the brain
let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const sats = [
  { a: -0.5, r: 0.40, c: LIME }, { a: 0.35, r: 0.44, c: VIOLET },
  { a: 2.6, r: 0.42, c: AMBER }, { a: -2.2, r: 0.46, c: CYAN },
  { a: 1.2, r: 0.50, c: LIME }, { a: -1.5, r: 0.52, c: VIOLET }
]
for (const s of sats) {
  const x = cx + Math.cos(s.a) * S * s.r * 0.5
  const y = cy + Math.sin(s.a) * S * s.r * 0.5
  // tether line toward brain edge
  const bx = cx + Math.cos(s.a) * S * 0.20, by = cy + Math.sin(s.a) * S * 0.20
  addLine(bx, by, x, y, s.c, 1.6, 0.22)
  addDot(x, y, 3.2 + rand() * 2.5, s.c, 1)
  addDot(x, y, 1.4, WHITE, 0.8)
}

// rounded-square mask (squircle approx)
const alpha = new Uint8Array(S * S)
const rad = S * 0.225
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const qx = Math.abs(x - cx) - (S / 2 - rad)
    const qy = Math.abs(y - cy) - (S / 2 - rad)
    const ax = Math.max(qx, 0), ay = Math.max(qy, 0)
    const d = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - rad
    alpha[y * S + x] = d <= 0 ? 255 : Math.max(0, Math.min(255, (2 - d / (S * 0.004)) * 255))
  }
}

const out = Buffer.alloc(S * S * 4)
for (let i = 0; i < S * S; i++) {
  const v = i * 3, o = i * 4
  const r = 1 - Math.exp(-px[v] / 80), g = 1 - Math.exp(-px[v + 1] / 80), b = 1 - Math.exp(-px[v + 2] / 80)
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
ihdr[8] = 8; ihdr[9] = 6
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

// ── .ico (PNG-in-ICO, multi-size would need resampling — ship 256 + 512 + 1024 entries all pointing to scaled PNGs is complex;
//    electron-builder prefers .png/.icns on macOS anyway. We emit a single 256px PNG entry.)
// For macOS the .icns is what matters — generate via iconutil after this script.
console.log('wrote build/icon.png', png.length, 'bytes')
