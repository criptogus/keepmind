import { useEffect, useRef } from 'react'

// Living neural field. Neurons drift, keep a few synapses each, and
// electrical pulses travel those links without ever stopping. A pulse
// that arrives charges the target and often fires the next synapse,
// so the field reads as a brain that is awake.

interface Neuron {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  charge: number
}

interface Spark {
  a: number
  b: number
  t: number
  speed: number
  chained: boolean
}

export default function NeuralField({ activity = 0 }: { activity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const actRef = useRef(activity)
  actRef.current = activity

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0
    let h = 0
    let raf = 0
    let last = 0
    let neurons: Neuron[] = []
    let sparks: Spark[] = []
    let neighbors: number[][] = []
    let neighborAt = 0

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, w * dpr)
      canvas.height = Math.max(1, h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(160, Math.max(70, Math.floor((w * h) / 14000)))
      neurons = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: 1.3 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        charge: Math.random()
      }))
      neighbors = neurons.map(() => [])
      sparks = []
    }

    const rebuildNeighbors = () => {
      const reach = 128
      for (let i = 0; i < neurons.length; i++) {
        const list: { j: number; d: number }[] = []
        const n = neurons[i]
        for (let j = 0; j < neurons.length; j++) {
          if (i === j) continue
          const m = neurons[j]
          const d = Math.hypot(m.x - n.x, m.y - n.y)
          if (d < reach) list.push({ j, d })
        }
        list.sort((a, b) => a.d - b.d)
        neighbors[i] = list.slice(0, 3).map(o => o.j)
      }
    }

    const fire = (from: number, chained: boolean) => {
      const outs = neighbors[from]
      if (!outs?.length) return
      const b = outs[Math.floor(Math.random() * outs.length)]
      if (sparks.some(s => s.a === from && s.b === b)) return
      sparks.push({
        a: from,
        b,
        t: 0,
        speed: (chained ? 0.0034 : 0.0022) + Math.random() * 0.0016,
        chained
      })
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const dt = Math.min(now - last, 32)
      last = now
      if (now - neighborAt > 280) {
        rebuildNeighbors()
        neighborAt = now
      }
      const boost = 1 + actRef.current * 1.4
      ctx.clearRect(0, 0, w, h)

      for (const n of neurons) {
        n.x += n.vx * dt * 0.045 * boost
        n.y += n.vy * dt * 0.045 * boost
        if (n.x < -30) n.x = w + 30
        if (n.x > w + 30) n.x = -30
        if (n.y < -30) n.y = h + 30
        if (n.y > h + 30) n.y = -30
        n.charge *= 0.985
      }

      ctx.lineWidth = 1
      for (let i = 0; i < neurons.length; i++) {
        for (const j of neighbors[i] ?? []) {
          if (j < i) continue
          const a = neurons[i]
          const b = neurons[j]
          const hot = Math.max(a.charge, b.charge)
          ctx.strokeStyle = hot > 0.2
            ? `rgba(125,211,252,${(0.18 + hot * 0.45).toFixed(3)})`
            : 'rgba(56,189,248,0.13)'
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.t += s.speed * dt * boost
        const A = neurons[s.a]
        const B = neurons[s.b]
        if (!A || !B || s.t >= 1) {
          if (B) {
            B.charge = 1
            if (Math.random() < (s.chained ? 0.42 : 0.62)) fire(s.b, true)
          }
          sparks.splice(i, 1)
          continue
        }
        const x = A.x + (B.x - A.x) * s.t
        const y = A.y + (B.y - A.y) * s.t
        const trail = Math.max(0, s.t - 0.12)
        const tx = A.x + (B.x - A.x) * trail
        const ty = A.y + (B.y - A.y) * trail
        ctx.strokeStyle = s.chained ? 'rgba(224,242,254,0.85)' : 'rgba(103,232,249,0.75)'
        ctx.lineWidth = s.chained ? 1.6 : 1.15
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(x, y)
        ctx.stroke()
        ctx.fillStyle = '#f0fbff'
        ctx.beginPath()
        ctx.arc(x, y, s.chained ? 2.3 : 1.8, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const n of neurons) {
        const breathe = 0.45 + 0.25 * Math.sin(now * 0.002 + n.phase)
        const glow = Math.min(1, breathe * 0.35 + n.charge)
        ctx.fillStyle = `rgba(125,211,252,${(0.08 + glow * 0.22).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r * (2.8 + n.charge * 2.2), 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = n.charge > 0.45 ? '#e0f2fe' : `rgba(186,230,253,${(0.55 + breathe * 0.4).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + n.charge * 1.3, 0, Math.PI * 2)
        ctx.fill()
      }

      const minSparks = 10 + Math.round(actRef.current * 8)
      let guard = 0
      while (sparks.length < minSparks && neurons.length > 4 && guard < 24) {
        fire(Math.floor(Math.random() * neurons.length), false)
        guard++
      }
    }

    resize()
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={ref} className="neural-field" aria-hidden="true" />
}
