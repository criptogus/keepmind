import { useEffect, useRef, useState } from 'react'
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'

// Living neural map — the vault as a firing brain. Nodes are notes, edges are
// [[wikilinks]], and glowing pulses travel the synapses in real time. Activity
// from the journal (chat writes, sleep cycles, automations) heats nearby
// synapses so the graph visibly "thinks" along with the brain. Connections can
// be hidden — nodes keep spiking like neurons either way.

const DIR_COLORS: Record<string, string> = {
  'long-term': '#22d3ee', 'medium-term': '#818cf8', 'short-term': '#38bdf8',
  'notes': '#34d399', 'daily': '#fbbf24', 'tasks': '#fb7185', 'insights': '#c084fc',
  'summaries': '#f472b6', 'entities': '#4ade80', 'meetings': '#facc15',
  'skills': '#2dd4bf', 'crm': '#fb923c', 'ops': '#94a3b8', 'agents': '#e879f9',
  'review': '#f87171', 'sleep': '#818cf8', 'inbox': '#a3a3a3'
}
const PALETTE = ['#22d3ee', '#818cf8', '#38bdf8', '#34d399', '#c084fc', '#f472b6', '#4ade80', '#2dd4bf']
function colorFor(dir: string) {
  if (DIR_COLORS[dir]) return DIR_COLORS[dir]
  let h = 0
  for (const c of dir) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

// radial glow sprite texture (shared)
let glowTex: THREE.CanvasTexture | null = null
function getGlowTex() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(160,220,255,.9)')
  g.addColorStop(0.6, 'rgba(80,160,255,.25)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

const PULSE_COUNT = 130

interface Pulse {
  link?: any          // synapse mode: travel source→target
  node?: any          // spike mode: flash at a node (connections hidden)
  t: number
  speed: number
  life: number
  hot: boolean
}

export default function GraphView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const pulsesRef = useRef<Pulse[]>([])
  const spritesRef = useRef<THREE.Sprite[]>([])
  const hotRef = useRef<Map<string, number>>(new Map()) // nodeId -> heat until ts
  const feedSourcesRef = useRef<string[]>([])
  const rafRef = useRef(0)
  const showLinksRef = useRef(true)
  const [showLinks, setShowLinks] = useState(true)
  const [stats, setStats] = useState<{ nodes: number; links: number; total: number } | null>(null)
  const [feed, setFeed] = useState<any[]>([])
  const [todayWrites, setTodayWrites] = useState(0)
  const [sourceCount, setSourceCount] = useState(0)
  const [sel, setSel] = useState<{ node: any; content: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { showLinksRef.current = showLinks }, [showLinks])

  // hide/show edges without rebuilding the simulation
  useEffect(() => {
    const g: any = graphRef.current
    if (!g) return
    g.linkColor(showLinks ? () => 'rgba(96,165,250,0.15)' : 'rgba(0,0,0,0)')
    g.linkWidth(showLinks ? () => 0.35 : 0)
  }, [showLinks])

  useEffect(() => {
    let dead = false
    ;(async () => {
      const data: any = await window.sb.brainGraph()
      if (dead || !mountRef.current) return
      setStats({ nodes: data.nodes.length, links: data.links.length, total: data.totalFiles })

      const links3d = data.links.map(([s, t]: [string, string]) => ({ source: s, target: t }))
      const nodes3d = data.nodes.map((n: any) => ({ ...n }))
      const nodeById = new Map(nodes3d.map((n: any) => [n.id, n]))

      // activity heats synapses around recently-written notes
      const heatNode = (id: string) => {
        hotRef.current.set(id, Date.now() + 45_000)
        for (const l of links3d) {
          const s: any = typeof l.source === 'object' ? l.source : nodeById.get(l.source)
          const t: any = typeof l.target === 'object' ? l.target : nodeById.get(l.target)
          if (s?.id === id) hotRef.current.set(t.id, Date.now() + 30_000)
          if (t?.id === id) hotRef.current.set(s.id, Date.now() + 30_000)
        }
      }

      const Graph: any = (ForceGraph3D as any)()
      graphRef.current = Graph(mountRef.current)
        .backgroundColor('rgba(0,0,0,0)')
        .showNavInfo(false)
        .nodeLabel((n: any) => `${n.label}\n${n.id}.md`)
        .nodeColor((n: any) => colorFor(n.dir))
        .nodeVal((n: any) => Math.min(1.6 + Math.sqrt(n.links) * 1.4, 9))
        .linkColor(() => 'rgba(96,165,250,0.15)')
        .linkWidth(() => 0.35)
        .linkDirectionalParticles(0)
        .onNodeClick(async (n: any) => {
          const content = await window.sb.brainMemoryFile(`${n.id}.md`).catch(() => null)
          setSel({ node: n, content })
          // user inspecting a node = interest signal → heat its synapses
          heatNode(n.id)
        })
        .graphData({ nodes: nodes3d, links: links3d })

      // ── synapse pulses + neuron spikes: sprites traveling links or flashing nodes ──
      const scene = Graph.scene()
      const tex = getGlowTex()
      const sprites: THREE.Sprite[] = []
      for (let i = 0; i < PULSE_COUNT; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false
        }))
        sp.scale.setScalar(0.001)
        scene.add(sp)
        sprites.push(sp)
      }
      spritesRef.current = sprites
      pulsesRef.current = []

      const pos = (n: any): any => n.__threeObj?.position ?? n

      const isHot = (id: string) => (hotRef.current.get(id) ?? 0) > Date.now()

      const spawnLinkPulse = (hotOnly: boolean): Pulse | null => {
        let pool = links3d
        if (hotOnly) {
          const hot = links3d.filter((l: any) => {
            const s = typeof l.source === 'object' ? l.source.id : l.source
            const t = typeof l.target === 'object' ? l.target.id : l.target
            return isHot(s) || isHot(t)
          })
          if (hot.length) pool = hot
        }
        const l = pool[Math.floor(Math.random() * pool.length)]
        if (!l) return null
        return { link: l, t: 0, speed: 0.004 + Math.random() * 0.012, life: 1, hot: hotOnly }
      }

      const spawnSpike = (hotOnly: boolean): Pulse | null => {
        // neuron firing in place — biased to hot nodes, big fast flash
        let pool = nodes3d
        if (hotOnly) {
          const hot = nodes3d.filter((n: any) => isHot(n.id))
          if (hot.length) pool = hot
        }
        const n = pool[Math.floor(Math.random() * pool.length)]
        if (!n) return null
        return { node: n, t: 0, speed: 0, life: 1, hot: hotOnly }
      }

      const spawn = (hot: boolean): Pulse | null => {
        if (!showLinksRef.current) return spawnSpike(hot)
        // mostly signal along synapses, some neurons firing in place —
        // keeps the connectome visibly "alive" even when idle
        return Math.random() < 0.8 ? spawnLinkPulse(hot) : spawnSpike(hot)
      }

      // seed ambient activity
      for (let i = 0; i < PULSE_COUNT * 0.6; i++) {
        const p = spawn(false)
        if (p) { p.t = Math.random(); pulsesRef.current.push(p) }
      }

      const tmp = new THREE.Vector3()
      let breatheIdx = 0
      const tick = () => {
        if (dead) return
        rafRef.current = requestAnimationFrame(tick)
        const now = Date.now()
        for (const [k, until] of hotRef.current) if (until < now) hotRef.current.delete(k)

        const pulses = pulsesRef.current
        while (pulses.length < PULSE_COUNT) {
          const hot = hotRef.current.size > 0 && Math.random() < 0.7
          const p = spawn(hot)
          if (p) pulses.push(p); else break
        }
        // if links toggled off mid-flight, convert link pulses to spikes
        if (!showLinksRef.current) {
          for (const p of pulses) if (p.link) { p.link = undefined; p.node = nodes3d[Math.floor(Math.random() * nodes3d.length)]; p.t = 0; p.speed = 0; p.life = Math.min(p.life, 0.6) }
        }

        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i]
          const sprite = sprites[i] ?? sprites[0]
          const flicker = 0.55 + Math.random() * 0.45

          if (p.node) {
            // ── neuron spike: flash at node position, fast decay ──
            p.life -= 0.03
            if (p.life <= 0) { pulses.splice(i, 1); continue }
            const np = pos(p.node)
            tmp.set(
              (np.x ?? 0) + (Math.random() - 0.5) * 2,
              (np.y ?? 0) + (Math.random() - 0.5) * 2,
              (np.z ?? 0) + (Math.random() - 0.5) * 2
            )
            sprite.position.copy(tmp)
            sprite.material.opacity = p.life * flicker
            sprite.scale.setScalar((p.hot ? 7 : 4.5) * (1.6 - p.life * 0.6) + Math.random())
            ;(sprite.material.color as THREE.Color).setHex(p.hot ? 0xe0f2fe : 0x67e8f9)
            continue
          }

          // ── synapse pulse: travel link source→target ──
          p.t += p.speed * (p.hot ? 1.8 : 1)
          p.life -= 0.004
          const l = p.link
          const s: any = typeof l.source === 'object' ? l.source : nodeById.get(l.source)
          const t: any = typeof l.target === 'object' ? l.target : nodeById.get(l.target)
          if (!s || !t || p.t >= 1 || p.life <= 0) {
            pulses.splice(i, 1)
            continue
          }
          const ps = pos(s); const pt = pos(t)
          tmp.set(
            (ps.x ?? 0) + ((pt.x ?? 0) - (ps.x ?? 0)) * p.t,
            (ps.y ?? 0) + ((pt.y ?? 0) - (ps.y ?? 0)) * p.t,
            (ps.z ?? 0) + ((pt.z ?? 0) - (ps.z ?? 0)) * p.t
          )
          sprite.position.copy(tmp)
          sprite.material.opacity = Math.min(1, p.life * 2) * flicker
          sprite.scale.setScalar(p.hot ? 2.6 + Math.random() * 1.6 : 1.4 + Math.random() * 0.9)
          ;(sprite.material.color as THREE.Color).setHex(p.hot ? 0xe0f2fe : 0x67e8f9)
        }
        for (let i = pulses.length; i < sprites.length; i++) sprites[i].material.opacity = 0

        // ── neuron breathing: a rotating subset of nodes gently pulses ──
        // (cheap JS scale on the Three object — no physics cost, always alive)
        const BR = 28
        for (let k = 0; k < BR; k++) {
          breatheIdx = (breatheIdx + 1) % nodes3d.length
          const n: any = nodes3d[breatheIdx]
          const o = n.__threeObj
          if (!o) continue
          if (o.__baseScale === undefined) o.__baseScale = o.scale.x || 1
          const w = 0.5 + 0.5 * Math.sin(now / 800 + breatheIdx * 2.39)
          o.scale.setScalar(o.__baseScale * (1 + w * 0.16))
        }

      }
      tick()

      // ── live heat: poll the activity journal, fire synapses near what changed ──
      const heatTimer = setInterval(async () => {
        try {
          const acts: any[] = await window.sb.brainActivity(40)
          for (const a of acts ?? []) {
            if (!a.path?.endsWith('.md')) continue
            const id = a.path.replace(/\.md$/, '')
            if (nodeById.has(id)) heatNode(id)
          }
        } catch { /* noop */ }
      }, 12_000)
      ;(Graph as any).__heatCleanup = () => clearInterval(heatTimer)

      // ── realtime: journal pushes heat the graph the instant a write lands ──
      const offPush = window.sb.onActivityPush?.((e: any) => {
        if (e?.path?.endsWith('.md')) {
          const id = e.path.replace(/\.md$/, '')
          if (nodeById.has(id)) {
            heatNode(id)
            // synapse bursts along the written node's links
            for (const l of links3d) {
              const s: any = typeof l.source === 'object' ? l.source.id : l.source
              const t: any = typeof l.target === 'object' ? l.target.id : l.target
              if ((s === id || t === id) && pulsesRef.current.length < PULSE_COUNT) {
                pulsesRef.current.push({ link: l, t: 0, speed: 0.02 + Math.random() * 0.02, life: 1, hot: true })
                if (pulsesRef.current.length > 2) break
              }
            }
          }
        }
        setFeed(f => [e, ...f].slice(0, 30))
        setTodayWrites(w => w + 1)
        setSourceCount(s => {
          const srcs = new Set(feedSourcesRef.current)
          srcs.add(e?.source ?? 'system')
          feedSourcesRef.current = [...srcs]
          return srcs.size
        })
      })
      ;(Graph as any).__offPush = offPush

      // initial feed + counters from the journal
      try {
        const acts: any[] = await window.sb.brainActivity(200)
        const dayStartDate = new Date()
        dayStartDate.setHours(0, 0, 0, 0)
        const dayStart = dayStartDate.getTime()
        setFeed((acts ?? []).slice(0, 8))
        setTodayWrites((acts ?? []).filter(a => a.ts >= dayStart).length)
        feedSourcesRef.current = [...new Set((acts ?? []).map(a => a.source ?? 'system'))]
        setSourceCount(feedSourcesRef.current.length)
      } catch { /* noop */ }

      setLoading(false)
    })()
    return () => {
      dead = true
      cancelAnimationFrame(rafRef.current)
      graphRef.current?.__heatCleanup?.()
      graphRef.current?.__offPush?.()
      for (const sp of spritesRef.current) { sp.parent?.remove(sp); sp.material.dispose() }
      spritesRef.current = []
      graphRef.current?._destructor?.()
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="view" style={{ position: 'relative', height: 'calc(100vh - 60px)', overflow: 'hidden' }}>
      <div className="view-head" style={{ position: 'absolute', zIndex: 5, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto', maxWidth: 560 }}>
          <div className="hud-tag" style={{ marginBottom: 6 }}>Mapa</div>
          <h1 style={{ fontSize: 22 }}>Memória ligada</h1>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            {stats ? `${stats.nodes} notas · ${stats.links} ligações · ${stats.total} arquivos` : 'Lendo a memória…'}
            {' '}Os pulsos são gravações ao vivo. Arraste para girar, role para aproximar, clique em um nó.
          </p>
        </div>
      </div>

      {/* live command center — the product's value, quantified */}
      <div style={{
        position: 'absolute', left: 20, bottom: 20, zIndex: 6, width: 330,
        background: 'rgba(4,8,20,.88)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(56,189,248,.18)', borderRadius: 14,
        padding: '14px 16px', pointerEvents: 'auto'
      }}>
        <div className="hud-tag" style={{ fontSize: 9, marginBottom: 4 }}>O que acabou de ser gravado</div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.02em', marginBottom: 10 }}>
          Memória em movimento
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 12 }}>
          {[
            { k: 'arquivos', v: stats ? stats.total.toLocaleString() : '—' },
            { k: 'ligações', v: stats ? stats.links.toLocaleString() : '—' },
            { k: 'gravações hoje', v: todayWrites.toLocaleString() },
            { k: 'origens', v: sourceCount || '—' }
          ].map(m => (
            <div key={m.k}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#e8f4ff', fontFamily: 'var(--mono)' }}>{m.v}</div>
              <div className="faint" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.08em' }}>{m.k}</div>
            </div>
          ))}
        </div>
        <div className="faint" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>
          últimas gravações
        </div>
        <div style={{ maxHeight: 148, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {feed.length === 0 && <p className="faint" style={{ fontSize: 11 }}>Ainda não houve gravação nesta sessão.</p>}
          {feed.slice(0, 7).map((e, i) => (
            <div key={`${e.ts}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
              <span className="mono faint" style={{ fontSize: 9.5, flexShrink: 0 }}>
                {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="mono" style={{
                fontSize: 8.5, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                color: e.op === 'remove' ? '#fb7185' : e.op === 'append' ? '#34d399' : '#38bdf8',
                border: '1px solid rgba(148,163,184,.25)'
              }}>{e.op?.toUpperCase()}</span>
              <span className="mono" style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                color: '#c084fc', border: '1px solid rgba(192,132,252,.25)', maxWidth: 90,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{e.source}</span>
              <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10.5 }}>
                {e.path?.split('/').slice(-2).join('/')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* connections toggle */}
      <button
        onClick={() => setShowLinks(v => !v)}
        title={showLinks ? 'Hide synapse connections' : 'Show synapse connections'}
        style={{
          position: 'absolute', bottom: 20, right: 20, zIndex: 6,
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(4,8,20,.85)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--line)', borderRadius: 20,
          padding: '7px 14px', fontFamily: 'var(--mono)', fontSize: 11,
          color: showLinks ? '#7dd3fc' : 'var(--text-faint)', cursor: 'pointer'
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: showLinks ? '#38bdf8' : '#334155',
          boxShadow: showLinks ? '0 0 8px #38bdf8' : 'none',
          transition: 'all .2s'
        }} />
        {showLinks ? 'ligações visíveis' : 'ligações ocultas'}
      </button>

      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 4 }}>
          <p className="faint" style={{ fontSize: 13 }}>Ligando o mapa…</p>
        </div>
      )}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {sel && (
        <div className="card card-pad" style={{
          position: 'absolute', top: 90, right: 20, width: 380, maxHeight: '70vh',
          overflowY: 'auto', zIndex: 6, background: 'rgba(4,8,20,.92)', backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div className="mono faint" style={{ fontSize: 10.5 }}>{sel.node.id}.md</div>
              <h3 style={{ fontSize: 15, marginTop: 2 }}>{sel.node.label}</h3>
              <div className="faint mono" style={{ fontSize: 10.5, marginTop: 2 }}>
                {sel.node.dir} · {sel.node.links} links
              </div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="msg__body" style={{ fontSize: 12, marginTop: 12, whiteSpace: 'pre-wrap', maxHeight: '50vh', overflowY: 'auto' }}>
            {sel.content?.slice(0, 6000) ?? '…'}
          </div>
        </div>
      )}
    </div>
  )
}
