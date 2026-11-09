import { useEffect, useRef } from 'react'

// Ambient starfield background: layered "neurons" that twinkle like stars —
// parallax depth, irregular brightness oscillation, diffraction spikes on
// the brightest ones, and rare synapse pulses. Everything stays under ~30%
// opacity so UI text remains perfectly readable.

interface Star {
  x: number; y: number; vx: number; vy: number
  r: number; layer: number
  phase: number; phase2: number; speed: number
  tint: string; spike: boolean
}
interface Pulse { a: number; b: number; t: number; speed: number }

const TINTS = ['#e0f2fe', '#bae6fd', '#f0f9ff', '#a5f3fc', '#dbeafe']
const WARM = '#fde68a'

export default function NeuralField({ activity = 0 }: { activity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const actRef = useRef(activity)
  actRef.current = activity

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0, raf = 0, last = 0
    let stars: Star[] = []
    let pulses: Pulse[] = []
    let nextPulse = 0
    let links: [number, number][] = []
    let frameCount = 0
    let glow: HTMLCanvasElement | null = null

    // Pre-rendered radial glow sprite — drawImage is far cheaper than
    // shadowBlur per star per frame.
    const makeGlow = () => {
      glow = document.createElement('canvas')
      glow.width = glow.height = 64
      const g = glow.getContext('2d')!
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255,255,255,0.85)')
      grad.addColorStop(0.25, 'rgba(186,230,253,0.35)')
      grad.addColorStop(1, 'rgba(186,230,253,0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
    }
    makeGlow()

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // denser starfield than before — depth comes from layers
      const count = Math.min(240, Math.max(70, Math.floor((w * h) / 9000)))
      stars = Array.from({ length: count }, () => {
        const layer = Math.random() < 0.45 ? 0 : Math.random() < 0.75 ? 1 : 2
        return {
          x: Math.random() * w, y: Math.random() * h,
          // parallax: farther layers drift slower
          vx: (Math.random() - 0.5) * (0.05 + layer * 0.09),
          vy: (Math.random() - 0.5) * (0.04 + layer * 0.07),
          r: 0.6 + layer * 0.55 + Math.random() * (0.7 + layer * 0.5),
          layer,
          phase: Math.random() * Math.PI * 2,
          phase2: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 1.1,
          tint: Math.random() < 0.06 ? WARM : TINTS[Math.floor(Math.random() * TINTS.length)],
          spike: false
        }
      })
      // only the biggest stars get diffraction spikes
      const biggest = [...stars].sort((a, b) => b.r - a.r).slice(0, Math.floor(stars.length * 0.12))
      biggest.forEach(s => { s.spike = true })
      links = []
    }

    // Synapse pairs change slowly (stars drift gently) — rebuild the
    // neighbor cache periodically instead of O(n²) distance checks/frame.
    const rebuildLinks = () => {
      links = []
      const maxD2 = 130 * 130
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]
        let best = -1, bd = maxD2
        for (let j = 0; j < stars.length; j++) {
          if (j === i) continue
          const o = stars[j]
          const dx = o.x - s.x, dy = o.y - s.y
          const d2 = dx * dx + dy * dy
          if (d2 < bd) { bd = d2; best = j }
        }
        if (best > i) links.push([i, best])
      }
    }

    const nearest = (s: Star, maxD: number) => {
      let best = -1, bd = maxD
      for (let i = 0; i < stars.length; i++) {
        const o = stars[i]
        if (o === s) continue
        const d = Math.hypot(o.x - s.x, o.y - s.y)
        if (d < bd) { bd = d; best = i }
      }
      return best
    }

    const spawnPulse = (now: number) => {
      const i = Math.floor(Math.random() * stars.length)
      const j = nearest(stars[i], 170)
      if (j >= 0) pulses.push({ a: i, b: j, t: 0, speed: 0.014 + Math.random() * 0.012 })
      // rare bursts when the app is active
      nextPulse = now + 1400 + Math.random() * 3200 - actRef.current * 700
    }

    const frame = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      ctx.clearRect(0, 0, w, h)
      const boost = 1 + actRef.current * 0.5
      const t = now * 0.001

      // drift + wrap (slower for far layers = parallax)
      for (const s of stars) {
        const k = (0.05 + s.layer * 0.09) * boost
        s.x += s.vx * dt * k * 8; s.y += s.vy * dt * k * 8
        if (s.x < -20) s.x = w + 20; if (s.x > w + 20) s.x = -20
        if (s.y < -20) s.y = h + 20; if (s.y > h + 20) s.y = -20
      }

      if (++frameCount % 40 === 0) rebuildLinks()

      // faint synapse threads — only between close pairs, barely there
      ctx.lineWidth = 0.5
      for (const [i, j] of links) {
        const s = stars[i], o = stars[j]
        const d = Math.hypot(o.x - s.x, o.y - s.y)
        const a = Math.max(0, 0.09 - d / 130 * 0.07) * (0.6 + s.layer * 0.2)
        ctx.strokeStyle = `rgba(56,189,248,${a.toFixed(3)})`
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(o.x, o.y); ctx.stroke()
      }

      // traveling synapse pulses — dimmer than before
      pulses = pulses.filter(p => {
        p.t += p.speed * dt * boost
        if (p.t >= 1) return false
        const A = stars[p.a], B = stars[p.b]
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t
        ctx.fillStyle = 'rgba(186,230,253,.55)'
        ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill()
        return true
      })

      // stars — irregular twinkle: two detuned sines + layer depth
      for (const s of stars) {
        const tw = 0.5 + 0.28 * Math.sin(t * s.speed + s.phase)
          + 0.22 * Math.sin(t * s.speed * 2.7 + s.phase2)
        const bright = Math.min(1, Math.max(0.12, tw))
        const alpha = (0.16 + s.layer * 0.12) * bright * (0.75 + actRef.current * 0.25)
        const glowSize = s.r * (4 + s.layer * 2) * (0.7 + bright * 0.6)

        // halo sprite
        if (glow) {
          ctx.globalAlpha = alpha * 0.5
          ctx.drawImage(glow, s.x - glowSize / 2, s.y - glowSize / 2, glowSize, glowSize)
          ctx.globalAlpha = 1
        }
        // core
        ctx.fillStyle = s.tint
        ctx.globalAlpha = alpha * 1.6
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill()
        ctx.globalAlpha = 1

        // diffraction spikes on the brightest stars
        if (s.spike && bright > 0.72) {
          const len = s.r * (5 + (bright - 0.72) * 14)
          const sa = (bright - 0.72) * 0.35 * (0.5 + s.layer * 0.25)
          ctx.strokeStyle = `rgba(224,242,254,${sa.toFixed(3)})`
          ctx.lineWidth = 0.7
          ctx.beginPath()
          ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y)
          ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len)
          ctx.stroke()
        }
      }

      if (now > nextPulse && stars.length > 3) spawnPulse(now)
      raf = requestAnimationFrame(frame)
    }

    resize()
    rebuildLinks()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={ref} className="neural-field" aria-hidden="true" />
}
