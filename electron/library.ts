import type Database from "better-sqlite3";
import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ImageDetail,
  ImageRow,
  ImageUserMeta,
  ImportResult,
  TargetRow,
} from "../shared/ipc";
import { readFitsHeader, renderFitsThumbnail, parseFitsRaDec } from "./fits";
import { solutionFromHeader, footprintToGeoJSON } from "./wcs";
import { Simbad } from "./simbad";
import { solve, SolverError, type SolverHint, type SolverKind } from "./solver";
import { scanFolder, type ScanResult, type ScannerSite } from "./rawScanner";
import type { RawSessionSummary } from "../shared/ipc";

const RASTER_EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"]);
const FITS_EXT = new Set([".fit", ".fits", ".fts"]);
const THUMB_MAX = 512;

export class Library {
  private simbad: Simbad;

  constructor(
    private db: Database.Database,
    private libraryDir: string,
  ) {
    this.simbad = new Simbad(db);
  }

  async init() {
    await mkdir(join(this.libraryDir, "originals"), { recursive: true });
    await mkdir(join(this.libraryDir, "thumbs"), { recursive: true });
  }

  async importPaths(paths: string[]): Promise<ImportResult> {
    const imported: ImageRow[] = [];
    const errors: { path: string; message: string }[] = [];

    for (const src of paths) {
      try {
        const row = await this.importOne(src);
        imported.push(row);
      } catch (e) {
        errors.push({ path: src, message: (e as Error).message });
      }
    }

    return { imported, errors };
  }

  private async importOne(src: string): Promise<ImageRow> {
    if (!existsSync(src)) throw new Error("file not found");
    const ext = extname(src).toLowerCase();
    const isFits = FITS_EXT.has(ext);
    if (!isFits && !RASTER_EXT.has(ext)) {
      throw new Error(`unsupported format: ${ext || "(none)"}`);
    }

    const uid = randomUUID();
    const destPath = join(this.libraryDir, "originals", `${uid}${ext}`);
    const thumbPath = join(this.libraryDir, "thumbs", `${uid}.jpg`);
    await copyFile(src, destPath);

    let widthPx: number | null = null;
    let heightPx: number | null = null;
    let format: string = ext.slice(1);
    let wcsFields: WcsFields = {};
    let dateObs: string | null = null;

    if (isFits) {
      const info = await readFitsHeader(destPath);
      widthPx = info.naxis1;
      heightPx = info.naxis2;
      format = "fits";
      dateObs = stringOrNull(info.header.get("DATE-OBS"));

      const sol = solutionFromHeader(info.header, info.naxis1, info.naxis2);
      if (sol) {
        wcsFields = {
          raDeg: sol.raDeg,
          decDeg: sol.decDeg,
          fovWDeg: sol.fovWDeg,
          fovHDeg: sol.fovHDeg,
          rotationDeg: sol.rotationDeg,
          pixelScaleArcsec: sol.pixelScaleArcsec,
          footprintGeoJson: footprintToGeoJSON(sol.footprint),
          solver: "FITS-WCS",
          solvedAt: new Date().toISOString(),
        };
      } else {
        const coords = parseFitsRaDec(info.header);
        if (coords) {
          wcsFields.raDeg = coords.ra;
          wcsFields.decDeg = coords.dec;
        }
      }

      const rendered = await renderFitsThumbnail(info, destPath, THUMB_MAX);
      if (rendered) {
        await sharp(rendered.data, {
          raw: { width: rendered.width, height: rendered.height, channels: 1 },
        })
          .jpeg({ quality: 80 })
          .toFile(thumbPath);
      }
    } else {
      const meta = await sharp(destPath).metadata();
      widthPx = meta.width ?? null;
      heightPx = meta.height ?? null;
      format = meta.format ?? ext.slice(1);
      await sharp(destPath)
        .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
    }

    const thumbExists = existsSync(thumbPath);

    const result = this.db
      .prepare(
        `INSERT INTO images
         (library_path, thumb_path, format, width_px, height_px, date_obs,
          ra_deg, dec_deg, fov_w_deg, fov_h_deg, rotation_deg, pixel_scale_arcsec,
          footprint_geojson, solver, solved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        destPath,
        thumbExists ? thumbPath : null,
        format,
        widthPx,
        heightPx,
        dateObs,
        wcsFields.raDeg ?? null,
        wcsFields.decDeg ?? null,
        wcsFields.fovWDeg ?? null,
        wcsFields.fovHDeg ?? null,
        wcsFields.rotationDeg ?? null,
        wcsFields.pixelScaleArcsec ?? null,
        wcsFields.footprintGeoJson ?? null,
        wcsFields.solver ?? null,
        wcsFields.solvedAt ?? null,
      );

    const id = Number(result.lastInsertRowid);
    return this.getRow(id)!;
  }

  async solveImage(
    id: number,
    kind: SolverKind,
    binPath: string,
    hint: SolverHint = {},
  ): Promise<ImageRow> {
    const row = this.getRow(id);
    if (!row) throw new Error("image not found");

    const seedHint: SolverHint = {
      raDeg: hint.raDeg ?? row.raDeg ?? undefined,
      decDeg: hint.decDeg ?? row.decDeg ?? undefined,
      radiusDeg: hint.radiusDeg,
      fovDeg: hint.fovDeg ?? row.fovWDeg ?? undefined,
    };

    let result;
    try {
      result = await solve(kind, binPath, row.libraryPath, seedHint);
    } catch (e) {
      if (e instanceof SolverError) throw e;
      throw new SolverError((e as Error).message, "");
    }

    const naxis1 = result.naxis1 || row.widthPx || 0;
    const naxis2 = result.naxis2 || row.heightPx || 0;
    const sol = solutionFromHeader(result.header, naxis1, naxis2);
    if (!sol) {
      throw new SolverError("solver succeeded but WCS could not be parsed", result.log);
    }

    this.db
      .prepare(
        `UPDATE images SET
           ra_deg = ?, dec_deg = ?, fov_w_deg = ?, fov_h_deg = ?,
           rotation_deg = ?, pixel_scale_arcsec = ?, footprint_geojson = ?,
           solver = ?, solved_at = ?
         WHERE id = ?`,
      )
      .run(
        sol.raDeg,
        sol.decDeg,
        sol.fovWDeg,
        sol.fovHDeg,
        sol.rotationDeg,
        sol.pixelScaleArcsec,
        footprintToGeoJSON(sol.footprint),
        kind,
        new Date().toISOString(),
        id,
      );

    return this.getRow(id)!;
  }

  async resolveTargetsForImage(id: number): Promise<TargetRow[]> {
    const row = this.getRow(id);
    if (!row || row.raDeg == null || row.decDeg == null) return [];
    const radius =
      row.fovWDeg && row.fovHDeg
        ? Math.max(row.fovWDeg, row.fovHDeg) / 2
        : 0.25;
    const hits = await this.simbad.coneSearch(row.raDeg, row.decDeg, radius);
    if (hits.length === 0) return [];

    const insertTarget = this.db.prepare(
      `INSERT INTO targets (name, ra_deg, dec_deg, type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         ra_deg = excluded.ra_deg,
         dec_deg = excluded.dec_deg,
         type = excluded.type
       RETURNING id`,
    );
    const link = this.db.prepare(
      `INSERT OR IGNORE INTO image_targets (image_id, target_id) VALUES (?, ?)`,
    );
    const clearLinks = this.db.prepare(`DELETE FROM image_targets WHERE image_id = ?`);

    const tx = this.db.transaction(() => {
      clearLinks.run(id);
      for (const h of hits) {
        const t = insertTarget.get(h.mainId, h.raDeg, h.decDeg, h.otype) as { id: number };
        link.run(id, t.id);
      }
    });
    tx();

    return this.getTargets(id);
  }

  getTargets(id: number): TargetRow[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name, t.ra_deg, t.dec_deg, t.type
         FROM targets t
         JOIN image_targets it ON it.target_id = t.id
         WHERE it.image_id = ?
         ORDER BY t.name`,
      )
      .all(id) as RawTarget[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      raDeg: r.ra_deg,
      decDeg: r.dec_deg,
      type: r.type,
    }));
  }

  list(): ImageRow[] {
    const rows = this.db
      .prepare("SELECT * FROM images ORDER BY imported_at DESC")
      .all() as RawImage[];
    return rows.map(toImageRow);
  }

  getRow(id: number): ImageRow | null {
    const row = this.db.prepare("SELECT * FROM images WHERE id = ?").get(id) as
      | RawImage
      | undefined;
    return row ? toImageRow(row) : null;
  }

  getDetail(id: number): ImageDetail | null {
    const base = this.getRow(id);
    if (!base) return null;
    const meta = this.db
      .prepare("SELECT * FROM image_user_meta WHERE image_id = ?")
      .get(id) as RawMeta | undefined;
    return {
      ...base,
      userMeta: toUserMeta(meta),
      targets: this.getTargets(id),
    };
  }

  updateMeta(id: number, m: Partial<ImageUserMeta>) {
    const existing = this.db
      .prepare("SELECT image_id FROM image_user_meta WHERE image_id = ?")
      .get(id);
    const filtersJson = m.filters !== undefined ? JSON.stringify(m.filters) : undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO image_user_meta
           (image_id, total_integration_s, filters_json, telescope, camera,
            mount, site_id, bortle, frame_count, palette)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          m.totalIntegrationS ?? null,
          filtersJson ?? null,
          m.telescope ?? null,
          m.camera ?? null,
          m.mount ?? null,
          m.siteId ?? null,
          m.bortle ?? null,
          m.frameCount ?? null,
          m.palette ?? null,
        );
      return;
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const map: Record<keyof ImageUserMeta, string> = {
      totalIntegrationS: "total_integration_s",
      filters: "filters_json",
      telescope: "telescope",
      camera: "camera",
      mount: "mount",
      siteId: "site_id",
      bortle: "bortle",
      frameCount: "frame_count",
      palette: "palette",
    };
    for (const [k, col] of Object.entries(map) as [keyof ImageUserMeta, string][]) {
      if (k in m) {
        sets.push(`${col} = ?`);
        vals.push(k === "filters" ? filtersJson ?? null : (m[k] ?? null));
      }
    }
    if (sets.length === 0) return;
    vals.push(id);
    this.db
      .prepare(`UPDATE image_user_meta SET ${sets.join(", ")} WHERE image_id = ?`)
      .run(...vals);
  }

  updateNotes(id: number, notes: string | null) {
    this.db.prepare("UPDATE images SET user_notes = ? WHERE id = ?").run(notes, id);
  }

  delete(id: number) {
    this.db.prepare("DELETE FROM images WHERE id = ?").run(id);
  }

  async linkRawFolder(
    imageId: number,
    folder: string,
    site: ScannerSite | null,
  ): Promise<ScanResult> {
    return scanFolder(this.db, imageId, folder, site);
  }

  unlinkRawSession(sessionId: number): void {
    this.db.prepare("DELETE FROM raw_sessions WHERE id = ?").run(sessionId);
  }

  rawSessions(imageId: number): RawSessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT rs.id, rs.folder_path, rs.scanned_at, rs.frame_count,
                COALESCE(SUM(rf.exposure_s), 0) AS total_exposure_s,
                SUM(CASE WHEN rf.rejected = 1 THEN 1 ELSE 0 END) AS rejected_count
         FROM raw_sessions rs
         LEFT JOIN raw_frames rf ON rf.session_id = rs.id
         WHERE rs.image_id = ?
         GROUP BY rs.id
         ORDER BY rs.scanned_at DESC`,
      )
      .all(imageId) as {
      id: number;
      folder_path: string;
      scanned_at: string | null;
      frame_count: number | null;
      total_exposure_s: number;
      rejected_count: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      folderPath: r.folder_path,
      scannedAt: r.scanned_at,
      frameCount: r.frame_count ?? 0,
      totalExposureS: r.total_exposure_s,
      rejectedCount: r.rejected_count,
    }));
  }
}

type WcsFields = {
  raDeg?: number;
  decDeg?: number;
  fovWDeg?: number;
  fovHDeg?: number;
  rotationDeg?: number;
  pixelScaleArcsec?: number;
  footprintGeoJson?: string;
  solver?: string;
  solvedAt?: string;
};

type RawImage = {
  id: number;
  library_path: string;
  thumb_path: string | null;
  format: string | null;
  width_px: number | null;
  height_px: number | null;
  date_obs: string | null;
  user_capture_date: string | null;
  user_notes: string | null;
  ra_deg: number | null;
  dec_deg: number | null;
  fov_w_deg: number | null;
  fov_h_deg: number | null;
  rotation_deg: number | null;
  pixel_scale_arcsec: number | null;
  footprint_geojson: string | null;
  solver: string | null;
  solved_at: string | null;
  imported_at: string;
};

type RawMeta = {
  image_id: number;
  total_integration_s: number | null;
  filters_json: string | null;
  telescope: string | null;
  camera: string | null;
  mount: string | null;
  site_id: number | null;
  bortle: number | null;
  frame_count: number | null;
  palette: string | null;
};

type RawTarget = {
  id: number;
  name: string;
  ra_deg: number | null;
  dec_deg: number | null;
  type: string | null;
};

function toImageRow(r: RawImage): ImageRow {
  return {
    id: r.id,
    libraryPath: r.library_path,
    thumbPath: r.thumb_path,
    format: r.format,
    widthPx: r.width_px,
    heightPx: r.height_px,
    dateObs: r.date_obs,
    userCaptureDate: r.user_capture_date,
    userNotes: r.user_notes,
    raDeg: r.ra_deg,
    decDeg: r.dec_deg,
    fovWDeg: r.fov_w_deg,
    fovHDeg: r.fov_h_deg,
    rotationDeg: r.rotation_deg,
    pixelScaleArcsec: r.pixel_scale_arcsec,
    footprintGeoJson: r.footprint_geojson,
    solver: r.solver,
    solvedAt: r.solved_at,
    importedAt: r.imported_at,
  };
}

function toUserMeta(r: RawMeta | undefined): ImageUserMeta {
  if (!r) {
    return {
      totalIntegrationS: null,
      filters: null,
      telescope: null,
      camera: null,
      mount: null,
      siteId: null,
      bortle: null,
      frameCount: null,
      palette: null,
    };
  }
  return {
    totalIntegrationS: r.total_integration_s,
    filters: r.filters_json ? (JSON.parse(r.filters_json) as string[]) : null,
    telescope: r.telescope,
    camera: r.camera,
    mount: r.mount,
    siteId: r.site_id,
    bortle: r.bortle,
    frameCount: r.frame_count,
    palette: r.palette,
  };
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}
