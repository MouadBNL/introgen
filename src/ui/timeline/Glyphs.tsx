/** Small inline glyphs for the timeline chrome. */
const S = (p: { d: string; fill?: boolean; size?: number }) => (
  <svg viewBox="0 0 12 12" width={p.size ?? 12} height={p.size ?? 12} aria-hidden fill={p.fill ? 'currentColor' : 'none'} stroke={p.fill ? 'none' : 'currentColor'} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d={p.d} />
  </svg>
);

export const Twirl = ({ open }: { open: boolean }) => (
  <span className={`tl-twirl${open ? ' open' : ''}`}><S fill size={10} d="M4 2.5 8.5 6 4 9.5z" /></span>
);
export const Eye = () => <S d="M1 6s1.8-3.4 5-3.4S11 6 11 6 9.2 9.4 6 9.4 1 6 1 6zM6 7.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8z" />;
export const EyeOff = () => <S d="M1.5 1.5l9 9M4.6 2.8A5 5 0 0 1 6 2.6C9.2 2.6 11 6 11 6s-.5 1-1.5 1.9M7.7 9a5 5 0 0 1-1.7.4C2.8 9.4 1 6 1 6s.6-1.1 1.7-2.1" />;
export const Lock = () => <S d="M3 5.5h6v4.5H3zM4.2 5.5V3.8a1.8 1.8 0 0 1 3.6 0v1.7" />;
export const Unlock = () => <S d="M3 5.5h6v4.5H3zM4.2 5.5V3.8a1.8 1.8 0 0 1 3.4-.800" />;
export const Stopwatch = () => <S d="M6 10.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM6 4.5v2l1.3.800M4.8 1h2.4" />;
export const Diamond = () => <S fill size={10} d="M6 1.5 10.5 6 6 10.5 1.5 6z" />;
export const Prev = () => <S fill size={9} d="M8 2.5 3.5 6 8 9.5z" />;
export const Next = () => <S fill size={9} d="M4 2.5 8.5 6 4 9.5z" />;
export const Magnet = () => <S d="M2.5 2v4a3.5 3.5 0 0 0 7 0V2H7.5v4a1.5 1.5 0 0 1-3 0V2zM2.5 3.8h2M7.5 3.8h2" />;
export const FitAll = () => <S d="M1 3.5V1.5h2M11 3.5V1.5H9M1 8.5v2h2M11 8.5v2H9M3.5 6h5M3.5 6l1.2-1.2M3.5 6l1.2 1.2M8.5 6 7.3 4.8M8.5 6 7.3 7.2" />;
export const Wiggle = () => <S d="M1 6c1.2-3.5 2.3-3.5 3.3 0s2.1 3.5 3.3 0 2.3-3.5 3.4 0" />;
export const Wave = () => <S d="M1.5 5v2M3.7 3.5v5M6 1.5v9M8.3 3.5v5M10.5 5v2" />;
