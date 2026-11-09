import { useEffect, useRef, useState } from 'react'
import ForceGraph3D from '3d-force-graph'
import * as THREE from 'three'

// Living neural map — the vault as a firing brain. Nodes are notes, edges are
// [[wikilinks]], and glowing pulses travel the synapses in real time. Activity
// from the journal (chat writes, sleep cycles, automations) heats nearby
// synapses so the graph visibly "thinks" along with the brain.

const DIR_COLORS: Record<string, string> = {
  'long-term': '#22d3ye', 'medium-term': '#818cf8', 'short-term': '#38bdf8',
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

const PULSE_COUNT = 90

interface Pulse { link: any; t: number; speed: number; life: number; hot: boolean }

export default function GraphView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const pulsesRef = useRef<Pulse[]>([])
  const spritesRef = useRef<THREE.Sprite[]>([])
  const hotRef = useRef<Map<string, number>>(new Map()) // nodeId -> heat until ts
  const rafRef = useRef(0)
  const [stats, setStats] = useState<{ nodes: number; links: number; total: number } | null>(null)
  const [sel, setSel] = useState<{ node: any; content: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    ;(async () => {
      const data: any = await window.sb.brainGraph()
      if (dead || !mountRef.current) return
      setStats({ nodes: data.nodes.length, links: data.links.length, total: data.totalFiles })

      const links3d = data.links.map(([s, t]: [string, string]) => ({ source: s, target: t }))
      const nodeById = new Map(data.nodes.map((n: any) => [n.id, n]))

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
        .graphData({ nodes: data.nodes.map((n: any) => ({ ...n })), links: links3d })

      // ── synapse pulses: sprites traveling link source→target ──
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

      const pickLink = (hotOnly: boolean) => {
        if (hotOnly) {
          const hot = links3d.filter((l: any) => {
            const s = typeof l.source === 'object' ? l.source.id : l.source
            const t = typeof l.target === 'object' ? l.target.id : l.target
            return (hotRef.current.get(s) ?? 0) > Date.now() || (hotRef.current.get(t) ?? 0) > Date.now()
          })
          if (hot.length) return hot[Math.floor(Math.random() * hot.length)]
        }
        return links3d[Math.floor(Math.random() * links3d.length)]
      }

      const spawn = (hot: boolean) => {
        const l = pickLink(hot)
        if (!l) return null
        return { link: l, t: 0, speed: 0.004 + Math.random() * 0.012, life: 1, hot }
      }
      // seed ambient pulses
      for (let i = 0; i < PULSE_COUNT * 0.6; i++) {
        const p = spawn(false)
        if (p) { p.t = Math.random(); pulsesRef.current.push(p) }
      }

      const tmp = new THREE.Vector3()
      const tick = () => {
        if (dead) return
        rafRef.current = requestAnimationFrame(tick)
        const now = Date.now()
        // decay heat
        for (const [k, until] of hotRef.current) if (until < now) hotRef.current.delete(k)

        const pulses = pulsesRef.current
        // maintain population — biased toward hot synapses
        while (pulses.length < PULSE_COUNT) {
          const hot = hotRef.current.size > 0 && Math.random() < 0.7
          const p = spawn(hot)
          if (p) pulses.push(p); else break
        }

        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i]
          p.t += p.speed * (p.hot ? 1.8 : 1)
          p.life -= 0.004
          const s: any = typeof p.link.source === 'object' ? p.link.source : nodeById.get(p.link.source)
          const t: any = typeof p.link.target === 'object' ? p.link.target : nodeById.get(p.link.target)
          if (!s || !t || p.t >= 1 || p.life <= 0) {
            pulses.splice(i, 1)
            continue
          }
          const sprite = sprites[i] ?? sprites[0]
          // d3-force-3d writes x/y/z on node datums; __threeObj.position is the fallback
          const pos = (n: any): any => n.__threeObj?.position ?? n
          const ps = pos(s); const pt = pos(t)
          tmp.set(
            (ps.x ?? 0) + ((pt.x ?? 0) - (ps.x ?? 0)) * p.t,
            (ps.y ?? 0) + ((pt.y ?? 0) - (ps.y ?? 0)) * p.t,
            (ps.z ?? 0) + ((pt.z ?? 0) - (ps.z ?? 0)) * p.t
          )
          sprite.position.copy(tmp)
          const flicker = 0.55 + Math.random() * 0.45
          sprite.material.opacity = Math.min(1, p.life * 2) * flicker
          sprite.scale.setScalar(p.hot ? 2.6 + Math.random() * 1.6 : 1.4 + Math.random() * 0.9)
          ;(sprite.material.color as THREE.Color).setHex(p.hot ? 0x7dd3fc : 0x38bdf8)
        }
        // hide unused sprites
        for (let i = pulses.length; i < sprites.length; i++) sprites[i].material.opacity = 0
      }
      tick()

      // probe removed
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
      const cleanupHeat = () => clearInterval(heatTimer)
      ;(Graph as any).__heatCleanup = cleanupHeat

      setLoading(false)
    })()
    return () => {
      dead = true
      cancelAnimationFrame(rafRef.current)
      graphRef.current?.__heatCleanup?.()
      for (const sp of spritesRef.current) { sp.parent?.remove(sp); sp.material.dispose() }
      spritesRef.current = []
      graphRef.current?._destructor?.()
      graphRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="view" style={{ position: 'relative', height: 'calc(100vh - 60px)' }}>
      <div className="view-head" style={{ position: 'absolute', zIndex: 5, pointerEvents: 'none' }}>
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>LIVE SYNAPTIC MAP</div>
          <h1 style={{ fontSize: 22 }}>Knowledge graph</h1>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            {stats ? `${stats.nodes} notes · ${stats.links} synapses · ${stats.total} files` : 'Scanning vault…'}
            {' '}— pulses are live memory writes. Drag to orbit, scroll to zoom, click a node.
          </p>
        </div>
      </div>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 4 }}>
          <p className="faint" style={{ fontSize: 13 }}>Firing up the connectome…</p>
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
