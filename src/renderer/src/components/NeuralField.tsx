import { useEffect, useRef } from 'react'

// Ambient neural-network background: nodes drift slowly, edges form between
// neighbors, occasional signal pulses fire along synapses. Rendered on a
// fixed canvas behind all UI — kept dim so text stays readable.

interface Node { x: number; y: number; vx: number; vy: number; r: number; phase: number }
interface Pulse { a: number; b: number; t: number; speed: number }

export default function NeuralField({ activity = 0 }: { activity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const actRef = useRef(activity)
  actRef.current = activity

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let w = 0, h = 0, raf = 0, last = 0
    let nodes: Node[] = []
    let pulses: Pulse[] = []
    let nextPulse = 0

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(110, Math.max(40, Math.floor((w * h) / 16000)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22, vy: (Math.random() - 0.5) * 0.22,
        r: 1 + Math.random() * 1.6, phase: Math.random() * Math.PI * 2
      }))
    }

    const edgesOf = (n: Node) =>
      nodes.map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
        .filter(o => o.d < 150)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)

    const spawnPulse = (now: number) => {
      const i = Math.floor(Math.random() * nodes.length)
      const e = edgesOf(nodes[i])[0]
      if (e !== undefined) pulses.push({ a: i, b: e.j, t: 0, speed: 0.012 + Math.random() * 0.01 })
      nextPulse = now + 500 + Math.random() * 1600 - actRef.current * 300
    }

    const frame = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      ctx.clearRect(0, 0, w, h)
      const boost = 1 + actRef.current * 0.8

      // drift + wrap
      for (const n of nodes) {
        n.x += n.vx * dt * 0.06 * boost; n.y += n.vy * dt * 0.06 * boost
        if (n.x < -20) n.x = w + 20; if (n.x > w + 20) n.x = -20
        if (n.y < -20) n.y = h + 20; if (n.y > h + 20) n.y = -20
      }

      // synapse edges
      ctx.lineWidth = 0.6
      for (let i = 0; i < nodes.length; i++) {
        for (const { j, d } of edgesOf(nodes[i])) {
          if (i >= j) continue
          const a = Math.max(0, 0.16 - d / 150 * 0.14)
          ctx.strokeStyle = `rgba(34,211,238,${a.toFixed(3)})`
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke()
        }
      }

      // pulses along edges
      pulses = pulses.filter(p => {
        p.t += p.speed * dt * boost
        if (p.t >= 1) return false
        const A = nodes[p.a], B = nodes[p.b]
        const x = A.x + (B.x - A.x) * p.t, y = A.y + (B.y - A.y) * p.t
        ctx.fillStyle = 'rgba(190,240,255,.9)'
        ctx.shadowColor = 'rgba(34,211,238,.9)'; ctx.shadowBlur = 8
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill()
        ctx.shadowBlur = 0
        return true
      })

      // neurons — gentle breathing glow
      for (const n of nodes) {
        const tw = 0.35 + 0.3 * Math.sin(now * 0.001 + n.phase)
        ctx.fillStyle = `rgba(125,211,252,${(tw * 0.5).toFixed(3)})`
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill()
        if (tw > 0.55) {
          ctx.fillStyle = `rgba(34,211,238,${(tw * 0.25).toFixed(3)})`
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.4, 0, 7); ctx.fill()
        }
      }

      if (now > nextPulse && nodes.length > 3) spawnPulse(now)
      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={ref} className="neural-field" aria-hidden="true" />
}
