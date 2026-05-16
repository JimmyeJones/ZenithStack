import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type Database from "better-sqlite3";
import * as Astronomy from "astronomy-engine";
import { readFitsHeader, type FitsHeader } from "./fits";

const FITS_EXT = new Set([".fit", ".fits", ".fts"]);

export type ScanResult = {
  sessionId: number;
  frameCount: number;
  rejectedCount: number;
  errors: { path: string; message: string }[];
};

export type ScannerSite = {
  lat: number;
  lon: number;
  elevationM: number | null;
};

export async function scanFolder(
  db: Database.Database,
  imageId: number,
  folder: string,
  site: ScannerSite | null,
): Promise<ScanResult> {
  const existing = db
    .prepare("SELECT id FROM raw_sessions WHERE image_id = ? AND folder_path = ?")
    .get(imageId, folder) as { id: number } | undefined;

  let sessionId: number;
  if (existing) {
    sessionId = existing.id;
    db.prepare("DELETE FROM raw_frames WHERE session_id = ?").run(sessionId);
  } else {
    const res = db
      .prepare(
        "INSERT INTO raw_sessions (image_id, folder_path, scanned_at) VALUES (?, ?, datetime('now'))",
      )
      .run(imageId, folder);
    sessionId = Number(res.lastInsertRowid);
  }

  const files = await walkFits(folder);
  const errors: { path: string; message: string }[] = [];
  let rejectedCount = 0;

  const insert = db.prepare(
    `INSERT INTO raw_frames
     (session_id, file_path, date_obs, exposure_s, filter,
      fwhm, eccentricity, snr, bg_mean, star_count,
      alt_deg, az_deg, airmass, moon_sep_deg, moon_phase, sun_alt_deg,
      rejected, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction((rows: FrameRow[]) => {
    for (const r of rows) insert.run(
      r.sessionId, r.path, r.dateObs, r.exposureS, r.filter,
      r.fwhm, r.eccentricity, r.snr, r.bgMean, r.starCount,
      r.altDeg, r.azDeg, r.airmass, r.moonSepDeg, r.moonPhase, r.sunAltDeg,
      r.rejected, r.rejectReason,
    );
  });

  const rows: FrameRow[] = [];

  for (const f of files) {
    try {
      const info = await readFitsHeader(f);
      const row = buildFrameRow(sessionId, f, info.header, site);
      if (row.rejected) rejectedCount++;
      rows.push(row);
    } catch (e) {
      errors.push({ path: f, message: (e as Error).message });
    }
  }

  tx(rows);

  db.prepare(
    "UPDATE raw_sessions SET frame_count = ?, scanned_at = datetime('now') WHERE id = ?",
  ).run(rows.length, sessionId);

  return { sessionId, frameCount: rows.length, rejectedCount, errors };
}

type FrameRow = {
  sessionId: number;
  path: string;
  dateObs: string | null;
  exposureS: number | null;
  filter: string | null;
  fwhm: number | null;
  eccentricity: number | null;
  snr: number | null;
  bgMean: number | null;
  starCount: number | null;
  altDeg: number | null;
  azDeg: number | null;
  airmass: number | null;
  moonSepDeg: number | null;
  moonPhase: number | null;
  sunAltDeg: number | null;
  rejected: number;
  rejectReason: string | null;
};

function buildFrameRow(
  sessionId: number,
  path: string,
  h: FitsHeader,
  site: ScannerSite | null,
): FrameRow {
  const dateObs = strOrNull(h.get("DATE-OBS"));
  const exposureS = numOrNull(h.get("EXPTIME") ?? h.get("EXPOSURE"));
  const filter = strOrNull(h.get("FILTER"));
  const fwhm = numFromKeys(h, ["FWHM", "FWHMARC", "MEDFWHM", "FWHM_MED", "SS_FWHM"]);
  const eccentricity = numFromKeys(h, ["SS_ECC", "ECC", "ECCENTR", "ECCENTRICITY"]);
  const snr = numFromKeys(h, ["SS_SNR", "SS_SNRWGT", "SNR"]);
  const bgMean = numFromKeys(h, ["SS_MEDIAN", "BGMEAN", "BACKGRND", "MEDIAN"]);
  const starCount = numFromKeys(h, ["SS_STARS", "NSTARS", "STARCOUNT", "DETECT"]);

  const inHeader = {
    altDeg: numFromKeys(h, ["OBJCTALT", "ALT_OBJ", "CENTALT"]),
    azDeg: numFromKeys(h, ["OBJCTAZ", "AZ_OBJ", "CENTAZ"]),
    airmass: numFromKeys(h, ["AIRMASS", "SECZ"]),
  };

  let altDeg = inHeader.altDeg;
  let azDeg = inHeader.azDeg;
  let airmass = inHeader.airmass;
  let moonSepDeg: number | null = null;
  let moonPhase: number | null = null;
  let sunAltDeg: number | null = null;

  const ra = numFromKeys(h, ["CRVAL1", "RA"]);
  const dec = numFromKeys(h, ["CRVAL2", "DEC"]);

  if (site && dateObs && ra != null && dec != null) {
    const date = new Date(dateObs.endsWith("Z") ? dateObs : dateObs + "Z");
    if (!isNaN(date.getTime())) {
      const obs = new Astronomy.Observer(site.lat, site.lon, site.elevationM ?? 0);
      const horiz = Astronomy.Horizon(date, obs, ra / 15, dec, "normal");
      altDeg = altDeg ?? horiz.altitude;
      azDeg = azDeg ?? horiz.azimuth;
      if (airmass == null && horiz.altitude > 0) {
        airmass = 1 / Math.cos((90 - horiz.altitude) * Math.PI / 180);
      }
      const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, obs, true, true);
      moonSepDeg = angularSeparation(ra, dec, moonEq.ra * 15, moonEq.dec);
      moonPhase = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
      const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
      sunAltDeg = Astronomy.Horizon(date, obs, sunEq.ra, sunEq.dec, "normal").altitude;
    }
  }

  const lowerPath = path.toLowerCase();
  const rejected =
    lowerPath.includes("reject") || lowerPath.includes("rejected") || lowerPath.includes("/bad/")
      ? 1
      : 0;

  return {
    sessionId, path,
    dateObs, exposureS, filter,
    fwhm, eccentricity, snr, bgMean, starCount,
    altDeg, azDeg, airmass, moonSepDeg, moonPhase, sunAltDeg,
    rejected,
    rejectReason: rejected ? "in reject folder" : null,
  };
}

async function walkFits(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const lower = e.name.toLowerCase();
        const dot = lower.lastIndexOf(".");
        if (dot >= 0 && FITS_EXT.has(lower.slice(dot))) {
          const s = await stat(full);
          if (s.size > 0) out.push(full);
        }
      }
    }
  }
  await walk(root);
  return out;
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v).trim();
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function numFromKeys(h: FitsHeader, keys: string[]): number | null {
  for (const k of keys) {
    const v = numOrNull(h.get(k));
    if (v != null) return v;
  }
  return null;
}

function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d = Math.PI / 180;
  const a = Math.sin(dec1 * d) * Math.sin(dec2 * d) +
    Math.cos(dec1 * d) * Math.cos(dec2 * d) * Math.cos((ra1 - ra2) * d);
  return Math.acos(Math.max(-1, Math.min(1, a))) / d;
}

// Re-export for usage; basename helper to keep tree-shaking happy elsewhere
export { basename };
