import type Database from "better-sqlite3";
import type { Analytics } from "../shared/ipc";

const SPHERE_DEG2 = 41252.96125;

export class AnalyticsStore {
  constructor(private db: Database.Database) {}

  compute(): Analytics {
    const totals = this.computeTotals();
    return {
      totals,
      byTargetIntegration: this.byTargetIntegration(),
      byTargetType: this.byTargetType(),
      byFilter: this.byFilter(),
      fovHistogram: this.fovHistogram(),
      pixelScaleHistogram: this.pixelScaleHistogram(),
      importsByMonth: this.importsByMonth(),
      coverageImages: this.coverageImages(),
    };
  }

  private computeTotals(): Analytics["totals"] {
    const imageCount = this.scalar<number>("SELECT COUNT(*) AS n FROM images", "n") ?? 0;
    const solvedCount =
      this.scalar<number>(
        "SELECT COUNT(*) AS n FROM images WHERE ra_deg IS NOT NULL",
        "n",
      ) ?? 0;
    const targetCount =
      this.scalar<number>(
        "SELECT COUNT(*) AS n FROM (SELECT DISTINCT target_id FROM image_targets)",
        "n",
      ) ?? 0;
    const integration =
      this.scalar<number>(
        "SELECT COALESCE(SUM(total_integration_s),0) AS s FROM image_user_meta",
        "s",
      ) ?? 0;

    const coverage =
      this.scalar<number>(
        "SELECT COALESCE(SUM(fov_w_deg * fov_h_deg),0) AS s FROM images WHERE fov_w_deg IS NOT NULL",
        "s",
      ) ?? 0;

    const dateRow = this.db
      .prepare(
        `SELECT
           MIN(COALESCE(date_obs, imported_at)) AS first,
           MAX(COALESCE(date_obs, imported_at)) AS last
         FROM images`,
      )
      .get() as { first: string | null; last: string | null };

    return {
      images: imageCount,
      solvedImages: solvedCount,
      targets: targetCount,
      totalIntegrationS: integration,
      skyCoverageDeg2: coverage,
      skyCoveragePct: (coverage / SPHERE_DEG2) * 100,
      dateRange: dateRow,
    };
  }

  private byTargetIntegration(): Analytics["byTargetIntegration"] {
    const rows = this.db
      .prepare(
        `SELECT t.name AS name,
                COALESCE(SUM(m.total_integration_s), 0) AS integration_s,
                COUNT(DISTINCT it.image_id) AS image_count
         FROM targets t
         JOIN image_targets it ON it.target_id = t.id
         LEFT JOIN image_user_meta m ON m.image_id = it.image_id
         GROUP BY t.id
         ORDER BY integration_s DESC, image_count DESC
         LIMIT 12`,
      )
      .all() as { name: string; integration_s: number; image_count: number }[];
    return rows.map((r) => ({
      name: r.name,
      integrationS: r.integration_s,
      imageCount: r.image_count,
    }));
  }

  private byTargetType(): Analytics["byTargetType"] {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(t.type, 'unknown') AS type, COUNT(DISTINCT t.id) AS count
         FROM targets t
         JOIN image_targets it ON it.target_id = t.id
         GROUP BY type
         ORDER BY count DESC`,
      )
      .all() as { type: string; count: number }[];
    return rows;
  }

  private byFilter(): Analytics["byFilter"] {
    const rows = this.db
      .prepare(
        `SELECT filters_json FROM image_user_meta WHERE filters_json IS NOT NULL`,
      )
      .all() as { filters_json: string }[];
    const tally = new Map<string, number>();
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.filters_json) as string[];
        for (const f of arr) {
          const key = f.trim();
          if (!key) continue;
          tally.set(key, (tally.get(key) ?? 0) + 1);
        }
      } catch {
        /* ignore */
      }
    }
    return Array.from(tally.entries())
      .map(([filter, count]) => ({ filter, count }))
      .sort((a, b) => b.count - a.count);
  }

  private fovHistogram(): Analytics["fovHistogram"] {
    const rows = this.db
      .prepare(
        `SELECT fov_w_deg AS w FROM images
         WHERE fov_w_deg IS NOT NULL`,
      )
      .all() as { w: number }[];
    const bins = [
      { label: "< 0.25°", lo: 0, hi: 0.25 },
      { label: "0.25–0.5°", lo: 0.25, hi: 0.5 },
      { label: "0.5–1°", lo: 0.5, hi: 1 },
      { label: "1–2°", lo: 1, hi: 2 },
      { label: "2–4°", lo: 2, hi: 4 },
      { label: "4–8°", lo: 4, hi: 8 },
      { label: "> 8°", lo: 8, hi: Infinity },
    ];
    return bins.map((b) => ({
      bin: b.label,
      count: rows.filter((r) => r.w >= b.lo && r.w < b.hi).length,
    }));
  }

  private pixelScaleHistogram(): Analytics["pixelScaleHistogram"] {
    const rows = this.db
      .prepare(
        `SELECT pixel_scale_arcsec AS p FROM images
         WHERE pixel_scale_arcsec IS NOT NULL`,
      )
      .all() as { p: number }[];
    const bins = [
      { label: '< 0.5"', lo: 0, hi: 0.5 },
      { label: '0.5–1"', lo: 0.5, hi: 1 },
      { label: '1–2"', lo: 1, hi: 2 },
      { label: '2–4"', lo: 2, hi: 4 },
      { label: '4–8"', lo: 4, hi: 8 },
      { label: '> 8"', lo: 8, hi: Infinity },
    ];
    return bins.map((b) => ({
      bin: b.label,
      count: rows.filter((r) => r.p >= b.lo && r.p < b.hi).length,
    }));
  }

  private importsByMonth(): Analytics["importsByMonth"] {
    const rows = this.db
      .prepare(
        `SELECT substr(COALESCE(date_obs, imported_at), 1, 7) AS month,
                COUNT(*) AS count
         FROM images
         GROUP BY month
         ORDER BY month`,
      )
      .all() as { month: string; count: number }[];
    return rows;
  }

  private coverageImages(): Analytics["coverageImages"] {
    const rows = this.db
      .prepare(
        `SELECT ra_deg, dec_deg, fov_w_deg, fov_h_deg, footprint_geojson
         FROM images
         WHERE ra_deg IS NOT NULL`,
      )
      .all() as {
        ra_deg: number;
        dec_deg: number;
        fov_w_deg: number | null;
        fov_h_deg: number | null;
        footprint_geojson: string | null;
      }[];
    return rows.map((r) => ({
      ra: r.ra_deg,
      dec: r.dec_deg,
      fovW: r.fov_w_deg,
      fovH: r.fov_h_deg,
      footprintGeoJson: r.footprint_geojson,
    }));
  }

  private scalar<T>(sql: string, col: string): T | null {
    const row = this.db.prepare(sql).get() as Record<string, T> | undefined;
    return row ? (row[col] ?? null) : null;
  }
}
