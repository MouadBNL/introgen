/** Browser file plumbing shared by the panels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (f: File | null) => { input.remove(); resolve(f); };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeFileName = (s: string) => s.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'untitled';

/** Duration of an encoded audio file. Offline context: decoding must not need a user gesture. */
export async function decodeDuration(file: Blob): Promise<number> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return buf.duration;
}
