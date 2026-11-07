import { useEffect, useRef } from 'react'

// BrainCore — a procedural "brain" made of ~420 neurons in two hemispheres.
// Static edges + traveling pulses; activity prop spikes firing rate & glow.

interface N { x: number; y: number; r: number; energy: number; hemi: 1 | -1 }
interface Edge { a: number; b: number }
interface Pulse { e: Edge; t: number; dir: 1 | -1; speed: number; hue: number }

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function BrainCore({ activity = 0, className = '', lite = false }: { activity?: number; className?: string; lite?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const actRef = useRef(activity)
  actRef.current = activity

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0, raf = 0
    let nodes: N[] = []
    let edges: Edge[] = []
    let pulses: Pulse[] = []
    let dpr = 1

    // offscreen sprite for cheap glow nodes
    const sprite = document.createElement('canvas')
    sprite.width = sprite.height = 64
    const sctx = sprite.getContext('2d')!
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(224,242,254,1)')
    grad.addColorStop(0.25, 'rgba(125,211,252,0.85)')
    grad.addColorStop(0.6, 'rgba(59,130,246,0.35)')
    grad.addColorStop(1, 'rgba(59,130,246,0)')
    sctx.fillStyle = grad
    sctx.fillRect(0, 0, 64, 64)

    const build = () => {
      const rand = mulberry32(42)
      nodes = []
      const cx = w / 2, cy = h / 2
      const rx = Math.min(w * 0.36, h * 0.40)
      const ry = h * 0.44
      const gap = rx * 0.10 // longitudinal fissure

      // rejection-sample points inside two ellipses, keep outside fissure
      let tries = 0
      const target = lite ? 170 : 420
      while (nodes.length < target && tries++ < 30000) {
        const a = rand() * Math.PI * 2
        const rr = Math.sqrt(rand())
        const x = cx + rr * rx * Math.cos(a)
        const y = cy + rr * ry * Math.sin(a) * 0.92
        // longitudinal fissure: keep nodes out of a vertical gap at center
        const inFissure = Math.abs(x - cx) < gap * (1 - Math.abs(y - cy) / ry * 0.4)
        if (inFissure) continue
        // cortical fold noise pushes nodes outward in ripples
        const fold = Math.sin(a * 7) * rx * 0.05 * Math.cos(a)
        nodes.push({
          x: x + fold,
          y: y + Math.sin(a * 5) * ry * 0.02,
          r: 0.8 + rand() * 1.6,
          energy: rand() * 0.4,
          hemi: x < cx ? -1 : 1
        })
      }

      // spatial grid for edge building
      const cell = 46
      const grid = new Map<string, number[]>()
      const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
      nodes.forEach((n, i) => {
        const k = key(n.x, n.y)
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k)!.push(i)
      })
      edges = []
      const seen = new Set<string>()
      nodes.forEach((n, i) => {
        const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell)
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${gx + ox},${gy + oy}`)
          if (!bucket) continue
          for (const j of bucket) {
            if (j <= i) continue
            const m = nodes[j]
            const d = Math.hypot(n.x - m.x, n.y - m.y)
            if (d < 42 && n.hemi === m.hemi) {
              const k = `${i}-${j}`
              if (!seen.has(k)) { seen.add(k); edges.push({ a: i, b: j }) }
            }
          }
        }
      })
      // cap edges for perf
      const edgeCap = lite ? 550 : 1600
      if (edges.length > edgeCap) {
        edges = edges.filter(() => Math.random() < edgeCap / edges.length)
      }
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 2)
      const rect = canvas.getBoundingClientRect()
      w = rect.width; h = rect.height
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      build()
      pulses = []
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(50, now - last); last = now
      const act = actRef.current
      ctx.clearRect(0, 0, w, h)

      const cx = w / 2, cy = h / 2

      // ambient core glow
      const coreR = Math.min(w, h) * (0.30 + Math.sin(now / 1400) * 0.015 + act * 0.03)
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      cg.addColorStop(0, `rgba(37,99,235,${0.16 + act * 0.08})`)
      cg.addColorStop(0.5, `rgba(29,78,216,${0.07 + act * 0.04})`)
      cg.addColorStop(1, 'rgba(3,7,18,0)')
      ctx.fillStyle = cg
      ctx.fillRect(0, 0, w, h)

      // edges
      ctx.lineWidth = 0.6
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b]
        const alpha = 0.05 + (a.energy + b.energy) * 0.10 + act * 0.05
        ctx.strokeStyle = `rgba(56,189,248,${Math.min(0.28, alpha)})`
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }

      // spawn pulses
      const spawnN = Math.floor((0.6 + act * 4) * (dt / 16) * (lite ? 0.45 : 1))
      for (let i = 0; i < spawnN && edges.length; i++) {
        const e = edges[(Math.random() * edges.length) | 0]
        pulses.push({
          e,
          t: 0,
          dir: Math.random() < 0.5 ? 1 : -1,
          speed: 0.012 + Math.random() * 0.02 + act * 0.01,
          hue: Math.random()
        })
        nodes[e.a].energy = Math.min(1, nodes[e.a].energy + 0.35)
        nodes[e.b].energy = Math.min(1, nodes[e.b].energy + 0.35)
      }
      if (pulses.length > 220) pulses.splice(0, pulses.length - 220)

      // pulses as glowing sprites
      for (const p of pulses) {
        p.t += p.speed * (dt / 16)
        if (p.t >= 1) { p.t = 0; if (Math.random() < 0.5) continue }
        const a = nodes[p.e.a], b = nodes[p.e.b]
        const t = p.dir === 1 ? p.t : 1 - p.t
        const x = a.x + (b.x - a.x) * t
        const y = a.y + (b.y - a.y) * t
        const s = 7 + p.hue * 5
        ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s)
      }
      pulses = pulses.filter(p => p.t < 1)

      // nodes
      for (const n of nodes) {
        n.energy = Math.max(0, n.energy - 0.006 * (dt / 16))
        const flicker = 0.75 + Math.sin(now / 900 + n.x * 0.05 + n.y * 0.03) * 0.25
        const alpha = (0.30 + n.energy * 0.65) * flicker
        const size = n.r * 2.4 + n.energy * 3.5
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.drawImage(sprite, n.x - size / 2, n.y - size / 2, size, size)
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(tick)
    }
    let running = true
    const start = () => { if (running && !raf) raf = requestAnimationFrame(tick) }
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0 }
    const onVis = () => { document.hidden ? stop() : (running = true, start()) }
    const onBlur = () => { if (document.hasFocus()) return; stop() }
    const onFocus = () => { running = true; start() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    raf = requestAnimationFrame(tick)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      ro.disconnect()
    }
  }, [lite])

  return <canvas ref={ref} className={`brain-core ${className}`} />
}
