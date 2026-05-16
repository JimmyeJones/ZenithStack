import type Database from "better-sqlite3";
import { net } from "electron";

const TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";

export type SimbadHit = {
  mainId: string;
  raDeg: number;
  decDeg: number;
  otype: string | null;
};

export class Simbad {
  constructor(private db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS simbad_cache (
        key         TEXT PRIMARY KEY,
        json        TEXT NOT NULL,
        fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  async coneSearch(raDeg: number, decDeg: number, radiusDeg: number): Promise<SimbadHit[]> {
    const key = `cone:${raDeg.toFixed(4)}:${decDeg.toFixed(4)}:${radiusDeg.toFixed(4)}`;
    const cached = this.fromCache(key);
    if (cached) return cached as SimbadHit[];

    const adql = `SELECT TOP 5 main_id, ra, dec, otype_txt,
        DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${raDeg}, ${decDeg})) AS d
      FROM basic
      WHERE CONTAINS(POINT('ICRS', ra, dec),
        CIRCLE('ICRS', ${raDeg}, ${decDeg}, ${radiusDeg})) = 1
        AND otype_txt IN ('Galaxy', 'GlobCluster', 'OpenCluster', 'PN', 'HII',
                           'EmObj', 'Nebula', 'MolCld', 'SNR', 'AGN', 'Seyfert',
                           'PartofG', 'IG', 'GroupG')
      ORDER BY d`;

    const rows = await this.runQuery(adql);
    const hits: SimbadHit[] = rows.map((r) => ({
      mainId: String(r[0]),
      raDeg: Number(r[1]),
      decDeg: Number(r[2]),
      otype: r[3] != null ? String(r[3]) : null,
    }));
    this.toCache(key, hits);
    return hits;
  }

  async resolveName(name: string): Promise<SimbadHit | null> {
    const key = `name:${name.toLowerCase()}`;
    const cached = this.fromCache(key);
    if (cached !== null) return (cached as SimbadHit[])[0] ?? null;

    const safe = name.replace(/'/g, "''");
    const adql = `SELECT TOP 1 b.main_id, b.ra, b.dec, b.otype_txt
      FROM ident JOIN basic AS b ON ident.oidref = b.oid
      WHERE id = '${safe}'`;
    const rows = await this.runQuery(adql);
    const hit: SimbadHit | null = rows[0]
      ? {
          mainId: String(rows[0][0]),
          raDeg: Number(rows[0][1]),
          decDeg: Number(rows[0][2]),
          otype: rows[0][3] != null ? String(rows[0][3]) : null,
        }
      : null;
    this.toCache(key, hit ? [hit] : []);
    return hit;
  }

  private fromCache(key: string): unknown {
    const row = this.db
      .prepare("SELECT json FROM simbad_cache WHERE key = ?")
      .get(key) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : null;
  }

  private toCache(key: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO simbad_cache (key, json) VALUES (?, ?)")
      .run(key, JSON.stringify(value));
  }

  private async runQuery(adql: string): Promise<unknown[][]> {
    const body = new URLSearchParams({
      request: "doQuery",
      lang: "ADQL",
      format: "json",
      query: adql,
    }).toString();

    const res = await net.fetch(TAP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`SIMBAD HTTP ${res.status}`);
    const json = (await res.json()) as { data?: unknown[][] };
    return json.data ?? [];
  }
}
