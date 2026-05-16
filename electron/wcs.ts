import type { FitsHeader } from "./fits";

export type WcsSolution = {
  raDeg: number;
  decDeg: number;
  fovWDeg: number;
  fovHDeg: number;
  rotationDeg: number;
  pixelScaleArcsec: number;
  footprint: { ra: number; dec: number }[];
};

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function solutionFromHeader(
  header: FitsHeader,
  naxis1: number,
  naxis2: number,
): WcsSolution | null {
  const ctype1 = String(header.get("CTYPE1") ?? "");
  const ctype2 = String(header.get("CTYPE2") ?? "");
  if (!ctype1.includes("RA") || !ctype2.includes("DEC")) return null;
  if (!ctype1.includes("TAN")) return null;

  const crval1 = num(header.get("CRVAL1"));
  const crval2 = num(header.get("CRVAL2"));
  const crpix1 = num(header.get("CRPIX1"));
  const crpix2 = num(header.get("CRPIX2"));
  if ([crval1, crval2, crpix1, crpix2].some((v) => v === null)) return null;

  let cd11 = num(header.get("CD1_1"));
  let cd12 = num(header.get("CD1_2"));
  let cd21 = num(header.get("CD2_1"));
  let cd22 = num(header.get("CD2_2"));

  if (cd11 === null || cd22 === null) {
    const cdelt1 = num(header.get("CDELT1"));
    const cdelt2 = num(header.get("CDELT2"));
    const crota = num(header.get("CROTA2")) ?? 0;
    if (cdelt1 === null || cdelt2 === null) return null;
    const c = Math.cos(crota * DEG);
    const s = Math.sin(crota * DEG);
    cd11 = cdelt1 * c;
    cd12 = -cdelt2 * s;
    cd21 = cdelt1 * s;
    cd22 = cdelt2 * c;
  }

  const cd: CDMatrix = {
    a: cd11!,
    b: cd12!,
    c: cd21!,
    d: cd22!,
  };

  const ra0 = crval1!;
  const dec0 = crval2!;
  const px = crpix1!;
  const py = crpix2!;

  const corners = [
    pixelToSky(0.5, 0.5, px, py, cd, ra0, dec0),
    pixelToSky(naxis1 + 0.5, 0.5, px, py, cd, ra0, dec0),
    pixelToSky(naxis1 + 0.5, naxis2 + 0.5, px, py, cd, ra0, dec0),
    pixelToSky(0.5, naxis2 + 0.5, px, py, cd, ra0, dec0),
  ];

  const det = Math.abs(cd.a * cd.d - cd.b * cd.c);
  const pixelScaleDeg = Math.sqrt(det);
  const pixelScaleArcsec = pixelScaleDeg * 3600;
  const fovWDeg = pixelScaleDeg * naxis1;
  const fovHDeg = pixelScaleDeg * naxis2;
  const rotationDeg = Math.atan2(cd.c, cd.a) * RAD;

  return {
    raDeg: normalizeRa(ra0),
    decDeg: dec0,
    fovWDeg,
    fovHDeg,
    rotationDeg,
    pixelScaleArcsec,
    footprint: corners,
  };
}

type CDMatrix = { a: number; b: number; c: number; d: number };

function pixelToSky(
  x: number,
  y: number,
  crpix1: number,
  crpix2: number,
  cd: CDMatrix,
  ra0: number,
  dec0: number,
): { ra: number; dec: number } {
  const dx = x - crpix1;
  const dy = y - crpix2;
  const xiDeg = cd.a * dx + cd.b * dy;
  const etaDeg = cd.c * dx + cd.d * dy;
  return deprojectTan(xiDeg * DEG, etaDeg * DEG, ra0 * DEG, dec0 * DEG);
}

function deprojectTan(
  xi: number,
  eta: number,
  ra0: number,
  dec0: number,
): { ra: number; dec: number } {
  const cosD0 = Math.cos(dec0);
  const sinD0 = Math.sin(dec0);
  const D = cosD0 - eta * sinD0;
  const ra = ra0 + Math.atan2(xi, D);
  const dec = Math.atan2(sinD0 + eta * cosD0, Math.sqrt(D * D + xi * xi));
  return { ra: normalizeRa(ra * RAD), dec: dec * RAD };
}

function normalizeRa(deg: number): number {
  let r = deg % 360;
  if (r < 0) r += 360;
  return r;
}

export function footprintToGeoJSON(footprint: { ra: number; dec: number }[]): string {
  const coords = footprint.map((c) => [c.ra, c.dec]);
  coords.push(coords[0]);
  return JSON.stringify({
    type: "Polygon",
    coordinates: [coords],
  });
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
