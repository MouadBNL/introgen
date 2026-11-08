/** Crisp 14px stroke icons. Drawn on a 14 grid with half-pixel coords so 1px-ish strokes stay sharp. */
import type { CSSProperties, ReactNode } from 'react';
import type { LayerType } from '../core/types';

const F = { fill: 'currentColor', stroke: 'none' } as const;

const P = {
  // layer types
  text3d: <><path d="M2.5 3.5h7v2M6 3.5v7.5M4.5 11h3" /><path d="M9.5 3.5l2-1.5v2l-2 1.5M7.5 11l2-1.5V6" opacity=".6" /></>,
  text2d: <path d="M2.5 4V2.5h9V4M7 2.5v9M5 11.5h4" />,
  logo: <path d="M7 1.5l4.8 2.75v5.5L7 12.5 2.2 9.75v-5.5zM7.8 3.8L5.2 7.5h3.6L6.2 10.2" />,
  image: <><rect x="1.5" y="2.5" width="11" height="9" rx="1" /><path d="M1.5 9.5l3-3 2.5 2.5 2-2 3.5 3.5" /><circle cx="9.5" cy="5" r=".9" {...F} /></>,
  light: <><path d="M5 9.5C4 8.6 3.2 7.6 3.2 6a3.8 3.8 0 017.6 0c0 1.6-.8 2.6-1.8 3.5z" /><path d="M5.2 11.5h3.6M6 13h2" /></>,
  particles: <><circle cx="3" cy="4" r="1" {...F} /><circle cx="7.5" cy="2.5" r=".8" {...F} /><circle cx="11" cy="5" r="1.2" {...F} /><circle cx="5.5" cy="7.5" r="1.2" {...F} /><circle cx="9.5" cy="9" r=".8" {...F} /><circle cx="3" cy="11" r=".8" {...F} /><circle cx="7" cy="11.5" r="1" {...F} /></>,
  streaks: <path d="M1.5 11c3-.5 3.5-3 5.5-4s3.5-.5 5.5-2.5M1.5 7c2-.5 2.5-2 4-3s3-.8 4.5-1.5M4 12.5c3 0 5-1.5 6-3s1.5-1.5 2.5-1.8" />,
  splash: <path d="M2 11.5h10M3 11.5c-.5-2-1-4-1-6l2 2.5 1-5 2 4 2-4 1 5 2-2.5c0 2-.5 4-1 6" />,
  dots: <>{[3, 7, 11].flatMap((x) => [3, 7, 11].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.05" {...F} />))}</>,
  debris: <path d="M2 5.5L5 2.5l3 1.5-1 3.5-4 .5zM9 7.5l3-1 .5 3-2.5 2-2-1.5zM3 10l2 .5-.5 2-2-.5z" />,
  lightning: <path d="M8 1.5L3 8h3.5L5.5 12.5 11 5.5H7.5z" />,
  shockwave: <><circle cx="7" cy="7" r="1.5" /><circle cx="7" cy="7" r="3.5" opacity=".75" /><circle cx="7" cy="7" r="5.5" opacity=".45" /></>,
  flare: <><circle cx="7" cy="7" r="1.5" {...F} /><path d="M7 1v3M7 10v3M.5 7h4M9.5 7h4M3 3l1.5 1.5M9.5 9.5L11 11M11 3L9.5 4.5M4.5 9.5L3 11" /></>,
  camera: <><rect x="1.5" y="4" width="8" height="6.5" rx="1" /><path d="M9.5 6.5l3-1.7v4.9l-3-1.7" /></>,
  post: <path d="M2 3.5h4M8.5 3.5H12M2 7h1.5M6 7h6M2 10.5h5.5M10 10.5h2M6 2.2v2.6M3.7 5.7v2.6M8 9.2v2.6" />,
  background: <><rect x="1.5" y="1.5" width="11" height="11" rx="1" /><path d="M1.5 9l7.5-7.5M5 12.5l7.5-7.5" opacity=".6" /></>,
  null: <><rect x="2.5" y="2.5" width="9" height="9" strokeDasharray="2 1.5" /><path d="M7 5v4M5 7h4" /></>,
  // transport
  play: <path d="M3.5 2l8 5-8 5z" {...F} />,
  pause: <><rect x="3" y="2" width="3" height="10" {...F} /><rect x="8" y="2" width="3" height="10" {...F} /></>,
  stepBack: <><rect x="2.5" y="2.5" width="1.5" height="9" {...F} /><path d="M11 2.5v9L5 7z" {...F} /></>,
  stepFwd: <><rect x="10" y="2.5" width="1.5" height="9" {...F} /><path d="M3 2.5v9L9 7z" {...F} /></>,
  toStart: <><rect x="1.5" y="2.5" width="1.5" height="9" {...F} /><path d="M7.5 2.5v9L3.5 7zM12.5 2.5v9L8.5 7z" {...F} /></>,
  toEnd: <><rect x="11" y="2.5" width="1.5" height="9" {...F} /><path d="M1.5 2.5v9L5.5 7zM6.5 2.5v9L10.5 7z" {...F} /></>,
  loop: <path d="M2 7V6a2.5 2.5 0 012.5-2.5H11M9 1.5l2 2-2 2M12 7v1a2.5 2.5 0 01-2.5 2.5H3M5 12.5l-2-2 2-2" />,
  // layer switches
  eye: <><path d="M1 7s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="7" cy="7" r="1.7" /></>,
  eyeOff: <path d="M2 2l10 10M5.5 3.3A5.5 5.5 0 017 3c3.8 0 6 4 6 4a10 10 0 01-1.9 2.3M9 10.6A5.2 5.2 0 017 11c-3.8 0-6-4-6-4a10 10 0 012.3-2.7" />,
  lock: <><rect x="2.5" y="6.5" width="9" height="6" rx="1" /><path d="M4.5 6.5V4.5a2.5 2.5 0 015 0v2" /></>,
  unlock: <><rect x="2.5" y="6.5" width="9" height="6" rx="1" /><path d="M4.5 6.5V4.5a2.5 2.5 0 014.8-1" /></>,
  solo: <><path d="M2 9V7a5 5 0 0110 0v2" /><rect x="1.5" y="8.5" width="2.5" height="4" rx=".8" /><rect x="10" y="8.5" width="2.5" height="4" rx=".8" /></>,
  link: <path d="M6 8a2.3 2.3 0 003.3 0l2-2A2.3 2.3 0 008 2.7l-.8.8M8 6a2.3 2.3 0 00-3.3 0l-2 2A2.3 2.3 0 006 11.3l.8-.8" />,
  // keyframing
  stopwatch: <><circle cx="7" cy="8" r="4.8" /><path d="M7 5.2V8l1.8 1.2M5.5 1.5h3M7 1.5v1.7" /></>,
  diamond: <path d="M7 2.5L11.5 7 7 11.5 2.5 7z" />,
  diamondOn: <path d="M7 2L12 7 7 12 2 7z" {...F} />,
  wave: <path d="M1 7h1.5l1-3 2 7 2-9 1.7 7L10.5 7H13" />,
  wiggle: <path d="M1 7c1-4 2-4 3 0s2 4 3 0 2-4 3 0 2 4 3 0" />,
  // general
  plus: <path d="M7 2.5v9M2.5 7h9" />,
  minus: <path d="M2.5 7h9" />,
  close: <path d="M3 3l8 8M11 3l-8 8" />,
  check: <path d="M2.5 7.5L5.5 10.5 11.5 3.5" />,
  more: <><circle cx="3" cy="7" r="1" {...F} /><circle cx="7" cy="7" r="1" {...F} /><circle cx="11" cy="7" r="1" {...F} /></>,
  chevL: <path d="M8.5 3L4.5 7l4 4" />,
  chevR: <path d="M5.5 3l4 4-4 4" />,
  chevD: <path d="M3 5.5l4 4 4-4" />,
  chevU: <path d="M3 8.5l4-4 4 4" />,
  trash: <path d="M2.5 3.5h9M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5M6 6v3.5M8 6v3.5" />,
  dice: <><rect x="2" y="2" width="10" height="10" rx="1.5" /><circle cx="4.8" cy="4.8" r=".9" {...F} /><circle cx="9.2" cy="4.8" r=".9" {...F} /><circle cx="7" cy="7" r=".9" {...F} /><circle cx="4.8" cy="9.2" r=".9" {...F} /><circle cx="9.2" cy="9.2" r=".9" {...F} /></>,
  upload: <path d="M7 9.5V2M4 5l3-3 3 3M2 9.5v3h10v-3" />,
  download: <path d="M7 2v7.5M4 6.5l3 3 3-3M2 9.5v3h10v-3" />,
  folder: <path d="M1.5 11.5V3h4l1.5 1.5h5.5v7z" />,
  film: <><rect x="1.5" y="2.5" width="11" height="9" rx="1" /><path d="M4.5 2.5v9M9.5 2.5v9M1.5 5.5h3M1.5 8.5h3M9.5 5.5h3M9.5 8.5h3" /></>,
  music: <><path d="M5 10.5V3l7-1.5V9" /><circle cx="3.5" cy="10.5" r="1.5" /><circle cx="10.5" cy="9" r="1.5" /></>,
  speaker: <path d="M1.5 5.5v3H4l3.5 3v-9L4 5.5zM9.5 5a3 3 0 010 4M11 3.5a5 5 0 010 7" />,
  layers: <path d="M7 1.5L12.5 4.5 7 7.5 1.5 4.5zM2.5 7L7 9.5 11.5 7M2.5 9.5L7 12 11.5 9.5" />,
  library: <path d="M2 2.5v9M4.5 2.5v9M7 3l3.5 8.5M10 2.5l2.5 9" />,
  gear: <><circle cx="7" cy="7" r="1.8" /><path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3.1 3.1l1.4 1.4M9.5 9.5l1.4 1.4M10.9 3.1L9.5 4.5M4.5 9.5l-1.4 1.4" /></>,
  safe: <><rect x="1.5" y="2.5" width="11" height="9" /><rect x="3.5" y="4.5" width="7" height="5" strokeDasharray="1.5 1" /></>,
  cube: <path d="M7 1.5l5 2.8v5.4l-5 2.8-5-2.8V4.3zM2 4.3L7 7l5-2.7M7 7v5.5" />,
  grade: <><circle cx="7" cy="7" r="5.5" /><path d="M7 1.5a5.5 5.5 0 010 11z" {...F} /></>,
  bolt: <path d="M8 1.5L3 8h3.5L5.5 12.5 11 5.5H7.5z" {...F} />,
  tap: <path d="M6 7V3a1 1 0 012 0v3.5l3 .8a1 1 0 01.8 1.1L11.3 12.5H6L3.5 9.5a1 1 0 011.5-1.3z" />,
  info: <><circle cx="7" cy="7" r="5.5" /><path d="M7 6.5V10M7 4v.5" /></>,
  sparkle: <path d="M7 1.5c.5 3 1.5 4 5 5.5-3.5 1.5-4.5 2.5-5 5.5-.5-3-1.5-4-5-5.5 3.5-1.5 4.5-2.5 5-5.5z" />,
  grid: <path d="M1.5 1.5h11v11h-11zM5.2 1.5v11M8.8 1.5v11M1.5 5.2h11M1.5 8.8h11" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof P;

export function Icon({ name, size = 14, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg className={className ? `ic ${className}` : 'ic'} width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor"
      strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function LayerIcon({ type, size, colored = true }: { type: LayerType; size?: number; colored?: boolean }) {
  return <Icon name={type} size={size} style={colored ? { color: `var(--lt-${type})` } : undefined} />;
}
