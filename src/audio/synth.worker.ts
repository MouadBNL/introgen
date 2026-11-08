/** Runs the generators off the main thread so the editor keeps its frame rate during a render. */
import type { MusicConfig, SfxId } from '../core/types';
import { renderMusic } from './music';
import { renderSfx } from './sfx';

export type SynthJob = { kind: 'music'; cfg: MusicConfig } | { kind: 'sfx'; sfx: SfxId; seed: number };

const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<{ id: number; job: SynthJob }>) => {
  const { id, job } = e.data;
  try {
    const out = job.kind === 'music' ? renderMusic(job.cfg) : renderSfx(job.sfx, job.seed);
    scope.postMessage({ id, l: out.l, r: out.r }, [out.l.buffer, out.r.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
