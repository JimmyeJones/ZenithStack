import type Database from "better-sqlite3";
import type { SiteRow } from "../shared/ipc";

type RawSite = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  elevation_m: number | null;
  tz: string | null;
};

export class SitesStore {
  constructor(private db: Database.Database) {}

  list(): SiteRow[] {
    const rows = this.db
      .prepare("SELECT * FROM sites ORDER BY name")
      .all() as RawSite[];
    return rows.map(toSite);
  }

  create(s: Omit<SiteRow, "id">): SiteRow {
    const res = this.db
      .prepare(
        "INSERT INTO sites (name, lat, lon, elevation_m, tz) VALUES (?, ?, ?, ?, ?)",
      )
      .run(s.name, s.lat, s.lon, s.elevationM, s.tz);
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(s: SiteRow): SiteRow {
    this.db
      .prepare(
        `UPDATE sites SET name=?, lat=?, lon=?, elevation_m=?, tz=? WHERE id=?`,
      )
      .run(s.name, s.lat, s.lon, s.elevationM, s.tz, s.id);
    return this.get(s.id)!;
  }

  delete(id: number): void {
    this.db.prepare("DELETE FROM sites WHERE id = ?").run(id);
  }

  get(id: number): SiteRow | null {
    const r = this.db.prepare("SELECT * FROM sites WHERE id = ?").get(id) as
      | RawSite
      | undefined;
    return r ? toSite(r) : null;
  }
}

function toSite(r: RawSite): SiteRow {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    elevationM: r.elevation_m,
    tz: r.tz,
  };
}
