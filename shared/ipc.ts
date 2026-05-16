export type AppInfo = {
  appVersion: string;
  platform: NodeJS.Platform;
  dbPath: string;
  libraryDir: string;
  imageCount: number;
};

export type ImageRow = {
  id: number;
  libraryPath: string;
  thumbPath: string | null;
  format: string | null;
  widthPx: number | null;
  heightPx: number | null;
  dateObs: string | null;
  userCaptureDate: string | null;
  userNotes: string | null;
  raDeg: number | null;
  decDeg: number | null;
  fovWDeg: number | null;
  fovHDeg: number | null;
  rotationDeg: number | null;
  pixelScaleArcsec: number | null;
  footprintGeoJson: string | null;
  solver: string | null;
  solvedAt: string | null;
  importedAt: string;
};

export type ImageUserMeta = {
  totalIntegrationS: number | null;
  filters: string[] | null;
  telescope: string | null;
  camera: string | null;
  mount: string | null;
  siteId: number | null;
  bortle: number | null;
  frameCount: number | null;
  palette: string | null;
};

export type TargetRow = {
  id: number;
  name: string;
  raDeg: number | null;
  decDeg: number | null;
  type: string | null;
};

export type ImageDetail = ImageRow & {
  userMeta: ImageUserMeta;
  targets: TargetRow[];
};

export type ImportResult = {
  imported: ImageRow[];
  errors: { path: string; message: string }[];
};

export type Analytics = {
  totals: {
    images: number;
    solvedImages: number;
    targets: number;
    totalIntegrationS: number;
    skyCoverageDeg2: number;
    skyCoveragePct: number;
    dateRange: { first: string | null; last: string | null };
  };
  byTargetIntegration: { name: string; integrationS: number; imageCount: number }[];
  byTargetType: { type: string; count: number }[];
  byFilter: { filter: string; count: number }[];
  fovHistogram: { bin: string; count: number }[];
  pixelScaleHistogram: { bin: string; count: number }[];
  importsByMonth: { month: string; count: number }[];
  coverageImages: {
    ra: number;
    dec: number;
    fovW: number | null;
    fovH: number | null;
    footprintGeoJson: string | null;
  }[];
};

export type Settings = {
  astapBinPath: string | null;
  astrometryBinPath: string | null;
  preferredSolver: "astap" | "astrometry-net";
};

export type SolverKind = "astap" | "astrometry-net";

export interface ZenithApi {
  getAppInfo(): Promise<AppInfo>;
  pickImageFiles(): Promise<string[]>;
  importImages(paths: string[]): Promise<ImportResult>;
  listImages(): Promise<ImageRow[]>;
  getImage(id: number): Promise<ImageDetail | null>;
  updateImageMeta(id: number, meta: Partial<ImageUserMeta>): Promise<void>;
  updateImageNotes(id: number, notes: string | null): Promise<void>;
  deleteImage(id: number): Promise<void>;
  resolveTargets(id: number): Promise<TargetRow[]>;
  getSettings(): Promise<Settings>;
  saveSettings(partial: Partial<Settings>): Promise<Settings>;
  pickBinary(): Promise<string | null>;
  plateSolve(id: number, kind?: SolverKind): Promise<ImageRow>;
  getAnalytics(): Promise<Analytics>;
}

declare global {
  interface Window {
    zenith: ZenithApi;
  }
}
