import type Database from "better-sqlite3";

export type Settings = {
  astapBinPath: string | null;
  astrometryBinPath: string | null;
  preferredSolver: "astap" | "astrometry-net";
};

const DEFAULTS: Settings = {
  astapBinPath: null,
  astrometryBinPath: null,
  preferredSolver: "astap",
};

export class SettingsStore {
  constructor(private db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  get(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      astapBinPath: map.get("solver.astap.binPath") ?? DEFAULTS.astapBinPath,
      astrometryBinPath:
        map.get("solver.astrometry.binPath") ?? DEFAULTS.astrometryBinPath,
      preferredSolver:
        (map.get("solver.preferred") as Settings["preferredSolver"]) ??
        DEFAULTS.preferredSolver,
    };
  }

  set(partial: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    );
    const tx = this.db.transaction(() => {
      if ("astapBinPath" in partial)
        stmt.run("solver.astap.binPath", partial.astapBinPath ?? "");
      if ("astrometryBinPath" in partial)
        stmt.run("solver.astrometry.binPath", partial.astrometryBinPath ?? "");
      if ("preferredSolver" in partial)
        stmt.run("solver.preferred", partial.preferredSolver ?? "astap");
    });
    tx();
    return this.get();
  }
}
