// Glow-style SVG icon set — stroke icons tinted cyan, glow via CSS drop-shadow.

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export function IconDashboard({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  )
}

export function IconChat({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3.2A8 8 0 1 1 21 12Z" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth={2.4} />
    </svg>
  )
}

export function IconAgents({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M15.8 14.4c2.6.2 4.4 1.7 5 4.1" />
    </svg>
  )
}

export function IconPlug({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v4" />
    </svg>
  )
}

export function IconSparkle({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2 6.5L20.5 10 14 12l-2 6.5L10 12 3.5 10 10 8.5 12 2Z" />
    </svg>
  )
}

export function IconDoc({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </svg>
  )
}

export function IconSend({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 12 20 4l-6 16-3.5-6.5L4 12Z" />
      <path d="M10.5 13.5 20 4" />
    </svg>
  )
}

export function IconSettings({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </svg>
  )
}

export function IconPlus({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconTrash({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  )
}

export function IconGithub({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.9 10.9c.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  )
}

// Pulsing brain logo — two hemispheres + fold curves + expanding pulse ring.
export function BrainMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="brain-mark">
      <defs>
        <filter id="bm-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="bm-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      {/* pulse rings */}
      <circle className="bm-pulse" cx="24" cy="24" r="15" fill="none" stroke="#22d3ee" strokeWidth="1" />
      <circle className="bm-pulse bm-pulse--2" cx="24" cy="24" r="15" fill="none" stroke="#38bdf8" strokeWidth="0.8" />
      {/* hemispheres */}
      <g filter="url(#bm-glow)" stroke="url(#bm-grad)" strokeWidth="1.8" fill="rgba(34,211,238,0.08)" strokeLinecap="round">
        <path d="M24 10c-5.5 0-9.5 3.8-9.5 9 0 2.6 1.2 4.8 2.8 6.4-1.8.8-3 2.4-3 4.4 0 2.8 2.4 5 5.7 5h8c3.3 0 5.7-2.2 5.7-5 0-2-1.2-3.6-3-4.4 1.6-1.6 2.8-3.8 2.8-6.4 0-5.2-4-9-9.5-9Z" />
        <path d="M24 10v20" strokeWidth="1.4" />
        {/* folds */}
        <path d="M17 17c2-1.4 4-2 7-2M17.5 24c2.2-1.2 4.5-1.6 6.5-1.6M17.5 30.5c2.4-.8 4.8-1 6.8-.8" strokeWidth="1.2" />
        <path d="M31 17c-2-1.4-4-2-7-2M30.5 24c-2.2-1.2-4.5-1.6-6.5-1.6M30.5 30.5c-2.4-.8-4.8-1-6.8-.8" strokeWidth="1.2" />
      </g>
      {/* core node */}
      <circle cx="24" cy="24" r="2.6" fill="#a5f3fc" className="bm-core" />
    </svg>
  )
}
