import type { MusicConfig } from '../core/types';

export interface MusicLayout {
  beat: number;        // seconds per beat
  bar: number;         // seconds per bar (4 beats)
  dropTime: number;    // seconds from music start
  duration: number;    // total seconds incl. tail
  sections: { name: string; start: number; end: number }[];
}

/** Reverb tail rendered after the last bar. */
export const MUSIC_TAIL = 2;

/** Pure timing of a generated track. The generator places every event from these numbers. */
export function musicLayout(cfg: MusicConfig): MusicLayout {
  const beat = 60 / Math.max(1, cfg.bpm);
  const bar = beat * 4;
  const build = Math.max(0, cfg.buildBars);
  const drop = Math.max(0, cfg.dropBars);
  const outro = Math.max(0, cfg.outroBars);
  const dropTime = build * bar;
  const dropEnd = dropTime + drop * bar;
  const duration = dropEnd + outro * bar + MUSIC_TAIL;
  return {
    beat,
    bar,
    dropTime,
    duration,
    sections: [
      { name: 'Build', start: 0, end: dropTime },
      { name: 'Drop', start: dropTime, end: dropEnd },
      { name: 'Outro', start: dropEnd, end: duration },
    ],
  };
}
