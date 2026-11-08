// Decorative neural-network layer for provider cards.
// Deterministic node layout per seed — glowing neurons + synapse edges
// with signal pulses flowing along them (pure CSS animations).

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function NeuralNet({ seed, color }: { seed: string; color: string }) {
  const rand = mulberry32(hashSeed(seed))
  const NODE_COUNT = 11
  const nodes = Array.from({ length: NODE_COUNT }, () => ({
    x: 6 + rand() * 88,
    y: 6 + rand() * 88,
    r: 1.4 + rand() * 2.4,
    d: rand() * 4 // animation delay
  }))
  // connect each node to its 2 nearest neighbors → organic synapse web
  const edges: [number, number][] = []
  nodes.forEach((n, i) => {
    const dists = nodes
      .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter(o => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
    for (const { j } of dists) if (i < j) edges.push([i, j])
  })

  return (
    <svg className="nn" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"
      style={{ ['--nnc' as any]: color }} aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line key={i} className="nn-edge" x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          style={{ stroke: color, animationDelay: `${(i % 7) * 0.9}s` }} />
      ))}
      {nodes.map((n, i) => (
        <g key={i}>
          {/* discharge halo — expands and fades like a neuron firing */}
          <circle className="nn-halo" cx={n.x} cy={n.y} r={n.r}
            style={{ stroke: color, animationDelay: `${n.d}s` }} />
          <circle className="nn-node" cx={n.x} cy={n.y} r={n.r}
            style={{ fill: color, animationDelay: `${n.d * 0.7}s` }} />
        </g>
      ))}
      {/* signal pulses traveling along a few edges */}
      {edges.slice(0, 4).map(([a, b], i) => (
        <circle key={`p${i}`} className="nn-pulse" r="0.9" fill="#fff"
          style={{ animationDelay: `${i * 1.7}s` }}>
          <animateMotion dur="4.5s" repeatCount="indefinite" path={`M ${nodes[a].x} ${nodes[a].y} L ${nodes[b].x} ${nodes[b].y}`} />
        </circle>
      ))}
    </svg>
  )
}
