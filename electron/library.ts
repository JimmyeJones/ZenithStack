import type Database from "better-sqlite3";
import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ImageDetail,
  ImageRow,
  ImageUserMeta,
  ImportResult,
} from "../shared/ipc";

const SUPPORTED_EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"]);
const THUMB_MAX = 512;

export class Library {
  constructor(
    private db: Database.Database,
    private libraryDir: string,
  ) {}

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
    if (!SUPPORTED_EXT.has(ext)) {
      throw new Error(`unsupported format: ${ext || "(none)"}`);
    }

    const uid = randomUUID();
    const safeName = `${uid}${ext}`;
    const destPath = join(this.libraryDir, "originals", safeName);
    await copyFile(src, destPath);

    const meta = await sharp(destPath).metadata();
    const thumbName = `${uid}.jpg`;
    const thumbPath = join(this.libraryDir, "thumbs", thumbName);
    await sharp(destPath)
      .resize({
        width: THUMB_MAX,
        height: THUMB_MAX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    const result = this.db
      .prepare(
        `INSERT INTO images
         (library_path, thumb_path, format, width_px, height_px)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        destPath,
        thumbPath,
        meta.format ?? ext.slice(1),
        meta.width ?? null,
        meta.height ?? null,
      );

    const id = Number(result.lastInsertRowid);
    return this.getRow(id)!;
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
    return { ...base, userMeta: toUserMeta(meta) };
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
}

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
