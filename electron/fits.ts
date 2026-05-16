import { open, FileHandle } from "node:fs/promises";

export type FitsHeader = Map<string, string | number>;

export type FitsInfo = {
  header: FitsHeader;
  naxis1: number;
  naxis2: number;
  naxis3: number | null;
  bitpix: number;
  bzero: number;
  bscale: number;
  dataOffset: number;
};

const BLOCK = 2880;
const CARD = 80;

export async function readFitsHeader(path: string): Promise<FitsInfo> {
  const fh = await open(path, "r");
  try {
    const header: FitsHeader = new Map();
    let offset = 0;
    let done = false;

    while (!done) {
      const buf = Buffer.alloc(BLOCK);
      const { bytesRead } = await fh.read(buf, 0, BLOCK, offset);
      if (bytesRead < BLOCK) throw new Error("truncated FITS header");
      offset += BLOCK;

      for (let i = 0; i < BLOCK; i += CARD) {
        const card = buf.subarray(i, i + CARD).toString("ascii");
        const key = card.slice(0, 8).trim();
        if (key === "END") {
          done = true;
          break;
        }
        if (!key || card[8] !== "=") continue;

        let valuePart = card.slice(9, 80);
        const slashIdx = findCommentSlash(valuePart);
        if (slashIdx >= 0) valuePart = valuePart.slice(0, slashIdx);
        const val = parseValue(valuePart.trim());
        if (val !== undefined) header.set(key, val);
      }
    }

    const naxis = Number(header.get("NAXIS") ?? 0);
    if (naxis < 2) throw new Error("not a 2-D image");
    const naxis1 = Number(header.get("NAXIS1") ?? 0);
    const naxis2 = Number(header.get("NAXIS2") ?? 0);
    const naxis3 = naxis >= 3 ? Number(header.get("NAXIS3") ?? 1) : null;
    const bitpix = Number(header.get("BITPIX") ?? 0);
    const bzero = Number(header.get("BZERO") ?? 0);
    const bscale = Number(header.get("BSCALE") ?? 1);

    return { header, naxis1, naxis2, naxis3, bitpix, bzero, bscale, dataOffset: offset };
  } finally {
    await fh.close();
  }
}

function findCommentSlash(s: string): number {
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") inString = !inString;
    else if (c === "/" && !inString) return i;
  }
  return -1;
}

function parseValue(s: string): string | number | undefined {
  if (s.length === 0) return undefined;
  if (s.startsWith("'")) {
    const end = s.lastIndexOf("'");
    return s.slice(1, end).replace(/''/g, "'").trim();
  }
  if (s === "T") return 1;
  if (s === "F") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

export async function renderFitsThumbnail(
  info: FitsInfo,
  srcPath: string,
  maxDim: number,
): Promise<{ data: Buffer; width: number; height: number } | null> {
  if (info.naxis3 && info.naxis3 > 1) return null;
  if (![8, 16, -32, 32].includes(info.bitpix)) return null;

  const fh = await open(srcPath, "r");
  try {
    const bytesPerPx = Math.abs(info.bitpix) / 8;
    const totalPx = info.naxis1 * info.naxis2;
    const totalBytes = totalPx * bytesPerPx;
    const buf = Buffer.alloc(totalBytes);
    const { bytesRead } = await fh.read(buf, 0, totalBytes, info.dataOffset);
    if (bytesRead < totalBytes) return null;

    const scale = Math.min(1, maxDim / Math.max(info.naxis1, info.naxis2));
    const dw = Math.max(1, Math.round(info.naxis1 * scale));
    const dh = Math.max(1, Math.round(info.naxis2 * scale));

    const samples = new Float32Array(dw * dh);
    const stepX = info.naxis1 / dw;
    const stepY = info.naxis2 / dh;

    for (let y = 0; y < dh; y++) {
      const sy = Math.floor(y * stepY);
      for (let x = 0; x < dw; x++) {
        const sx = Math.floor(x * stepX);
        const idx = sy * info.naxis1 + sx;
        samples[y * dw + x] = readPixel(buf, idx, info);
      }
    }

    const { lo, hi } = percentileClip(samples, 0.005, 0.995);
    const range = hi - lo || 1;
    const out = Buffer.alloc(dw * dh);
    const stretchFactor = 10;
    const denom = Math.log10(1 + stretchFactor);
    for (let i = 0; i < samples.length; i++) {
      const t = Math.max(0, Math.min(1, (samples[i] - lo) / range));
      const stretched = Math.log10(1 + stretchFactor * t) / denom;
      out[i] = Math.round(stretched * 255);
    }
    return { data: out, width: dw, height: dh };
  } finally {
    await fh.close();
  }
}

function readPixel(buf: Buffer, idx: number, info: FitsInfo): number {
  const { bitpix, bzero, bscale } = info;
  let raw: number;
  if (bitpix === 8) raw = buf.readUInt8(idx);
  else if (bitpix === 16) raw = buf.readInt16BE(idx * 2);
  else if (bitpix === 32) raw = buf.readInt32BE(idx * 4);
  else raw = buf.readFloatBE(idx * 4);
  return bzero + bscale * raw;
}

function percentileClip(arr: Float32Array, lo: number, hi: number): { lo: number; hi: number } {
  const sorted = Float32Array.from(arr).sort();
  const n = sorted.length;
  return {
    lo: sorted[Math.floor(lo * (n - 1))],
    hi: sorted[Math.floor(hi * (n - 1))],
  };
}

export function parseFitsRaDec(header: FitsHeader): { ra: number; dec: number } | null {
  const ra = header.get("RA") ?? header.get("OBJCTRA") ?? header.get("CRVAL1");
  const dec = header.get("DEC") ?? header.get("OBJCTDEC") ?? header.get("CRVAL2");
  if (ra === undefined || dec === undefined) return null;
  const raDeg = typeof ra === "number" ? ra : parseSexagesimal(String(ra), true);
  const decDeg = typeof dec === "number" ? dec : parseSexagesimal(String(dec), false);
  if (raDeg === null || decDeg === null) return null;
  return { ra: raDeg, dec: decDeg };
}

function parseSexagesimal(s: string, isRa: boolean): number | null {
  const parts = s.trim().split(/[\s:]+/).map(Number);
  if (parts.some(Number.isNaN)) return null;
  const [h, m = 0, sec = 0] = parts;
  const sign = h < 0 || /^-/.test(s.trim()) ? -1 : 1;
  const mag = Math.abs(h) + m / 60 + sec / 3600;
  return sign * mag * (isRa ? 15 : 1);
}
