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

export type ImageDetail = ImageRow & { userMeta: ImageUserMeta };

export type ImportResult = {
  imported: ImageRow[];
  errors: { path: string; message: string }[];
};

export interface ZenithApi {
  getAppInfo(): Promise<AppInfo>;
  pickImageFiles(): Promise<string[]>;
  importImages(paths: string[]): Promise<ImportResult>;
  listImages(): Promise<ImageRow[]>;
  getImage(id: number): Promise<ImageDetail | null>;
  updateImageMeta(id: number, meta: Partial<ImageUserMeta>): Promise<void>;
  updateImageNotes(id: number, notes: string | null): Promise<void>;
  deleteImage(id: number): Promise<void>;
}

declare global {
  interface Window {
    zenith: ZenithApi;
  }
}
