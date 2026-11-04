/** Minimal Layer III frame parser/concatenator for ElevenLabs CBR MP3 clips. */
export class Mp3Error extends Error {}

type Frame = { offset: number; length: number; version: number; layer: number; bitrate: number; sampleRate: number; padding: number; channelMode: number };
const BITRATES: Record<number, number[]> = {
  3: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  0: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
};

function parseFrame(b: Uint8Array, offset: number): Frame | null {
  if (offset + 4 > b.length || b[offset] !== 0xff || (b[offset + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[offset + 1] >> 3) & 3, layer = (b[offset + 1] >> 1) & 3;
  const bi = (b[offset + 2] >> 4) & 15, sr = (b[offset + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bi === 0 || bi === 15 || sr === 3) return null;
  const base = [44100, 48000, 32000][sr];
  const sampleRate = version === 3 ? base : version === 2 ? base / 2 : base / 4;
  const bitrate = BITRATES[version][bi] * 1000;
  const padding = (b[offset + 2] >> 1) & 1;
  const length = Math.floor((version === 3 ? 144 : 72) * bitrate / sampleRate) + padding;
  if (offset + length > b.length) return null;
  return { offset, length, version, layer, bitrate, sampleRate, padding, channelMode: b[offset + 3] >> 6 };
}

function audioStart(b: Uint8Array): number {
  if (b.length >= 10 && String.fromCharCode(...b.slice(0,3)) === "ID3") {
    const size = ((b[6]&0x7f)<<21)|((b[7]&0x7f)<<14)|((b[8]&0x7f)<<7)|(b[9]&0x7f);
    const start = 10 + size + ((b[5]&0x10) ? 10 : 0);
    if (start > b.length) throw new Mp3Error("truncated ID3 tag");
    return start;
  }
  return 0;
}

function frames(bytes: Uint8Array): Frame[] {
  let at = audioStart(bytes); const out: Frame[] = [];
  // Skip valid ancillary bytes before first MPEG frame.
  while (at < bytes.length && !parseFrame(bytes, at)) at++;
  while (at < bytes.length) {
    const f = parseFrame(bytes, at);
    if (!f) {
      // Ignore trailing ID3v1 tag only; refuse corrupted/gapped streams.
      if (bytes.length - at === 128 && String.fromCharCode(...bytes.slice(at, at+3)) === "TAG") break;
      throw new Mp3Error(`invalid or truncated MP3 frame at byte ${at}`);
    }
    out.push(f); at += f.length;
  }
  if (!out.length) throw new Mp3Error("no MPEG Layer III frames found");
  return out;
}

function isInfoFrame(bytes: Uint8Array, f: Frame): boolean {
  // Xing/Info frame belongs to encoder metadata; removing it avoids duplicate headers.
  const sideInfo = f.version === 3 ? (f.channelMode === 3 ? 17 : 32) : (f.channelMode === 3 ? 9 : 17);
  const pos = f.offset + 4 + sideInfo;
  const marker = String.fromCharCode(...bytes.slice(pos, pos + 4));
  return marker === "Xing" || marker === "Info";
}

/** Concatenate compatible CBR streams while preserving every real audio frame. */
export function concatenateMp3(clips: Uint8Array[]): Uint8Array {
  if (!clips.length) throw new Mp3Error("no audio clips to assemble");
  const chunks: Uint8Array[] = [];
  let reference: Frame | undefined, total = 0;
  for (const clip of clips) {
    const parsed = frames(clip);
    let start = parsed[0].offset;
    for (const f of parsed) {
      if (isInfoFrame(clip, f)) { start = f.offset + f.length; continue; }
      if (!reference) reference = f;
      if (f.version !== reference.version || f.layer !== reference.layer || f.sampleRate !== reference.sampleRate || f.bitrate !== reference.bitrate)
        throw new Mp3Error("clips use incompatible MP3 formats; cannot safely concatenate");
      if (f.offset >= start) { chunks.push(clip.slice(f.offset, f.offset + f.length)); total += f.length; }
    }
  }
  if (!total) throw new Mp3Error("no audio frames remain after metadata removal");
  const result = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function validateMp3(bytes: Uint8Array): {frames: number; durationSeconds: number} {
  const list = frames(bytes), first = list[0];
  if (list.some(f => f.version !== first.version || f.sampleRate !== first.sampleRate || f.bitrate !== first.bitrate))
    throw new Mp3Error("assembled MP3 is not constant bitrate");
  const samples = first.version === 3 ? 1152 : 576;
  return { frames: list.length, durationSeconds: list.length * samples / first.sampleRate };
}
