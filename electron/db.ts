import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  library_path        TEXT NOT NULL,
  thumb_path          TEXT,
  format              TEXT,
  width_px            INTEGER,
  height_px           INTEGER,
  date_obs            TEXT,
  user_capture_date   TEXT,
  user_notes          TEXT,
  ra_deg              REAL,
  dec_deg             REAL,
  fov_w_deg           REAL,
  fov_h_deg           REAL,
  rotation_deg        REAL,
  pixel_scale_arcsec  REAL,
  footprint_geojson   TEXT,
  solver              TEXT,
  solved_at           TEXT,
  imported_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS image_user_meta (
  image_id            INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  total_integration_s INTEGER,
  filters_json        TEXT,
  telescope           TEXT,
  camera              TEXT,
  mount               TEXT,
  site_id             INTEGER,
  bortle              INTEGER,
  frame_count         INTEGER,
  palette             TEXT
);

CREATE TABLE IF NOT EXISTS targets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  ra_deg      REAL,
  dec_deg     REAL,
  type        TEXT,
  catalog_id  TEXT
);

CREATE TABLE IF NOT EXISTS image_targets (
  image_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  PRIMARY KEY (image_id, target_id)
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  elevation_m REAL,
  tz          TEXT
);

CREATE TABLE IF NOT EXISTS raw_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id    INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  folder_path TEXT NOT NULL,
  scanned_at  TEXT,
  frame_count INTEGER
);

CREATE TABLE IF NOT EXISTS raw_frames (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES raw_sessions(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  date_obs        TEXT,
  exposure_s      REAL,
  filter          TEXT,
  fwhm            REAL,
  eccentricity    REAL,
  snr             REAL,
  bg_mean         REAL,
  star_count      INTEGER,
  alt_deg         REAL,
  az_deg          REAL,
  airmass         REAL,
  moon_sep_deg    REAL,
  moon_phase      REAL,
  sun_alt_deg     REAL,
  rejected        INTEGER NOT NULL DEFAULT 0,
  reject_reason   TEXT
);

CREATE INDEX IF NOT EXISTS idx_raw_frames_session ON raw_frames(session_id);
CREATE INDEX IF NOT EXISTS idx_images_radec ON images(ra_deg, dec_deg);
`;

export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function countImages(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM images").get() as { n: number };
  return row.n;
}
