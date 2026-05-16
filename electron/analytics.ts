import type Database from "better-sqlite3";
import type { Analytics, RawAnalytics } from "../shared/ipc";

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

  computeRaw(): RawAnalytics {
    const totalImages =
      this.scalar<number>("SELECT COUNT(*) AS n FROM images", "n") ?? 0;
    const imagesLinked =
      this.scalar<number>(
        "SELECT COUNT(DISTINCT image_id) AS n FROM raw_sessions",
        "n",
      ) ?? 0;
    const totalFrames =
      this.scalar<number>("SELECT COUNT(*) AS n FROM raw_frames", "n") ?? 0;
    const rejectedFrames =
      this.scalar<number>(
        "SELECT COUNT(*) AS n FROM raw_frames WHERE rejected = 1",
        "n",
      ) ?? 0;
    const totalExposureS =
      this.scalar<number>(
        "SELECT COALESCE(SUM(exposure_s),0) AS s FROM raw_frames WHERE rejected = 0",
        "s",
      ) ?? 0;

    return {
      imagesLinked,
      totalImages,
      totalFrames,
      rejectedFrames,
      totalExposureS,
      fwhmHistogram: this.histogram(
        "SELECT fwhm AS v FROM raw_frames WHERE fwhm IS NOT NULL",
        [
          { label: '< 1.5"', lo: 0, hi: 1.5 },
          { label: '1.5–2"', lo: 1.5, hi: 2 },
          { label: '2–2.5"', lo: 2, hi: 2.5 },
          { label: '2.5–3"', lo: 2.5, hi: 3 },
          { label: '3–4"', lo: 3, hi: 4 },
          { label: '> 4"', lo: 4, hi: Infinity },
        ],
      ),
      eccentricityHistogram: this.histogram(
        "SELECT eccentricity AS v FROM raw_frames WHERE eccentricity IS NOT NULL",
        [
          { label: "< 0.3", lo: 0, hi: 0.3 },
          { label: "0.3–0.4", lo: 0.3, hi: 0.4 },
          { label: "0.4–0.5", lo: 0.4, hi: 0.5 },
          { label: "0.5–0.6", lo: 0.5, hi: 0.6 },
          { label: "0.6–0.7", lo: 0.6, hi: 0.7 },
          { label: "> 0.7", lo: 0.7, hi: Infinity },
        ],
      ),
      altitudeHistogram: this.histogram(
        "SELECT alt_deg AS v FROM raw_frames WHERE alt_deg IS NOT NULL",
        [
          { label: "< 20°", lo: 0, hi: 20 },
          { label: "20–30°", lo: 20, hi: 30 },
          { label: "30–45°", lo: 30, hi: 45 },
          { label: "45–60°", lo: 45, hi: 60 },
          { label: "60–75°", lo: 60, hi: 75 },
          { label: "> 75°", lo: 75, hi: 91 },
        ],
      ),
      moonSepHistogram: this.histogram(
        "SELECT moon_sep_deg AS v FROM raw_frames WHERE moon_sep_deg IS NOT NULL",
        [
          { label: "< 30°", lo: 0, hi: 30 },
          { label: "30–60°", lo: 30, hi: 60 },
          { label: "60–90°", lo: 60, hi: 90 },
          { label: "90–120°", lo: 90, hi: 120 },
          { label: "120–180°", lo: 120, hi: 181 },
        ],
      ),
      moonPhaseHistogram: this.histogram(
        "SELECT moon_phase AS v FROM raw_frames WHERE moon_phase IS NOT NULL",
        [
          { label: "0–10% (new)", lo: 0, hi: 0.1 },
          { label: "10–30%", lo: 0.1, hi: 0.3 },
          { label: "30–60%", lo: 0.3, hi: 0.6 },
          { label: "60–90%", lo: 0.6, hi: 0.9 },
          { label: "90–100% (full)", lo: 0.9, hi: 1.01 },
        ],
      ),
      filterFrameCount: (this.db
        .prepare(
          `SELECT filter, COUNT(*) AS frames, COALESCE(SUM(exposure_s),0) AS exposure_s
           FROM raw_frames
           WHERE filter IS NOT NULL AND rejected = 0
           GROUP BY filter
           ORDER BY frames DESC`,
        )
        .all() as { filter: string; frames: number; exposure_s: number }[]).map(
        (r) => ({ filter: r.filter, frames: r.frames, exposureS: r.exposure_s }),
      ),
      nightsByMonth: this.db
        .prepare(
          `SELECT substr(date_obs, 1, 7) AS month,
                  COUNT(DISTINCT substr(date_obs, 1, 10)) AS nights,
                  COUNT(*) AS frames
           FROM raw_frames
           WHERE date_obs IS NOT NULL
           GROUP BY month
           ORDER BY month`,
        )
        .all() as { month: string; nights: number; frames: number }[],
    };
  }

  private histogram(
    sql: string,
    bins: { label: string; lo: number; hi: number }[],
  ): { bin: string; count: number }[] {
    const rows = this.db.prepare(sql).all() as { v: number }[];
    return bins.map((b) => ({
      bin: b.label,
      count: rows.filter((r) => r.v >= b.lo && r.v < b.hi).length,
    }));
  }

  private scalar<T>(sql: string, col: string): T | null {
    const row = this.db.prepare(sql).get() as Record<string, T> | undefined;
    return row ? (row[col] ?? null) : null;
  }
}
