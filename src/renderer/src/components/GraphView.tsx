import { useEffect, useRef, useState } from 'react'
import ForceGraph3D from '3d-force-graph'

// 3D neural map of the vault — nodes are notes, edges are [[wikilinks]].
// Colored by top-level directory so memory tiers are visible at a glance.

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

export default function GraphView() {
  const mountRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<any>(null)
  const [stats, setStats] = useState<{ nodes: number; links: number; total: number } | null>(null)
  const [sel, setSel] = useState<{ node: any; content: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    ;(async () => {
      const data: any = await window.sb.brainGraph()
      if (dead || !mountRef.current) return
      setStats({ nodes: data.nodes.length, links: data.links.length, total: data.totalFiles })
      const Graph: any = (ForceGraph3D as any)()
      graphRef.current = Graph(mountRef.current)
        .backgroundColor('rgba(0,0,0,0)')
        .showNavInfo(false)
        .nodeLabel((n: any) => `${n.label}\n${n.id}.md`)
        .nodeColor((n: any) => colorFor(n.dir))
        .nodeVal((n: any) => Math.min(2 + Math.sqrt(n.links) * 1.5, 10))
        .linkColor(() => 'rgba(96,165,250,0.18)')
        .linkWidth(() => 0.4)
        .onNodeClick(async (n: any) => {
          const content = await window.sb.brainMemoryFile(`${n.id}.md`).catch(() => null)
          setSel({ node: n, content })
        })
        .graphData({
          nodes: data.nodes.map((n: any) => ({ ...n })),
          links: data.links.map(([s, t]: [string, string]) => ({ source: s, target: t }))
        })
      setLoading(false)
    })()
    return () => { dead = true; graphRef.current?._destructor?.(); graphRef.current = null }
  }, [])

  return (
    <div className="view" style={{ position: 'relative', height: 'calc(100vh - 60px)' }}>
      <div className="view-head" style={{ position: 'absolute', zIndex: 5, pointerEvents: 'none' }}>
        <div>
          <div className="hud-tag" style={{ marginBottom: 6 }}>NEURAL MAP</div>
          <h1 style={{ fontSize: 22 }}>Knowledge graph</h1>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
            {stats ? `${stats.nodes} linked notes · ${stats.links} connections · ${stats.total} files total` : 'Scanning vault…'}
            {' '}— drag to orbit, scroll to zoom, click a node to read it.
          </p>
        </div>
      </div>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 4 }}>
          <p className="faint" style={{ fontSize: 13 }}>Building graph…</p>
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
