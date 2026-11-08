/**
 * Introgen mark: an extruded, bevelled "I" sliced by a lightning cut, with the
 * chromatic-aberration ghosting every 2015 intro had. Pure SVG, no assets.
 */
export function LogoMark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Introgen" role="img" className={animated ? 'ig-logo ig-logo-anim' : 'ig-logo'}>
      <defs>
        <linearGradient id="igFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#ffd3dc" />
          <stop offset="1" stopColor="#ff8aa2" />
        </linearGradient>
        <linearGradient id="igSide" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff2d55" />
          <stop offset="1" stopColor="#8a0022" />
        </linearGradient>
        <linearGradient id="igBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a0710" />
          <stop offset="1" stopColor="#0b0b0d" />
        </linearGradient>
        <radialGradient id="igGlow" cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#ff2d55" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff2d55" stopOpacity="0" />
        </radialGradient>
        <clipPath id="igTop"><polygon points="0,0 64,0 64,25 0,39" /></clipPath>
        <clipPath id="igBot"><polygon points="0,39 64,25 64,64 0,64" /></clipPath>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#igBg)" />
      <rect x="1" y="1" width="62" height="62" rx="14" fill="url(#igGlow)" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="#ff2d55" strokeOpacity="0.35" />
      {/* The glyph: an I-beam. Drawn twice, split along the lightning cut and offset. */}
      {(['igTop', 'igBot'] as const).map((clip, i) => (
        <g key={clip} clipPath={`url(#${clip})`} transform={i === 0 ? 'translate(-1.6,-1.2)' : 'translate(1.6,1.2)'}>
          {/* chroma ghosts */}
          <path d={IBEAM} transform="translate(-1.4,0)" fill="#00e5ff" opacity="0.55" style={{ mixBlendMode: 'screen' }} />
          <path d={IBEAM} transform="translate(1.4,0)" fill="#ff003c" opacity="0.65" style={{ mixBlendMode: 'screen' }} />
          {/* extrusion */}
          <path d={IBEAM} transform="translate(3,3.4)" fill="url(#igSide)" />
          <path d={IBEAM} transform="translate(1.5,1.7)" fill="url(#igSide)" />
          {/* face */}
          <path d={IBEAM} fill="url(#igFace)" />
          <path d={IBEAM_HI} fill="#ffffff" opacity="0.9" />
        </g>
      ))}
      {/* the cut spark */}
      <polygon points="9,41 55,23.4 56,25 10,42.6" fill="#fff" opacity="0.95" />
      <polygon points="9,41 55,23.4 56,25 10,42.6" fill="#ff2d55" opacity="0.5" transform="translate(0,1.4)" />
    </svg>
  );
}

const IBEAM = 'M19 12 H45 L43 19 H37 V45 H43 L45 52 H19 L21 45 H27 V19 H21 Z';
const IBEAM_HI = 'M19.6 12.6 H44.2 L43.6 14 H20.2 Z';

export function LogoWordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="ig-wordmark" style={{ fontSize: size, fontFamily: "'Black Ops One', var(--font-ui)", letterSpacing: '0.06em', lineHeight: 1, display: 'inline-flex', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-0)', textShadow: '-1px 0 rgba(0,229,255,.45), 1px 0 rgba(255,0,60,.55)' }}>INTRO</span>
      <span style={{ color: 'var(--accent)' }}>GEN</span>
    </span>
  );
}
