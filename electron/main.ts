import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { openDatabase, countImages } from "./db";
import { Library } from "./library";
import { SettingsStore } from "./settings";
import { AnalyticsStore } from "./analytics";
import { SitesStore } from "./sites";
import type { SiteRow } from "../shared/ipc";
import type { AppInfo, ImageUserMeta, Settings, SolverKind } from "../shared/ipc";

const isDev = !app.isPackaged;

let db: Database.Database | null = null;
let library: Library | null = null;
let settings: SettingsStore | null = null;
let analytics: AnalyticsStore | null = null;
let sites: SitesStore | null = null;

function dbPath(): string {
  return join(app.getPath("userData"), "zenithstack.db");
}

function libraryDir(): string {
  return join(app.getPath("userData"), "library");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "zenith", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#0b0d12",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  db = openDatabase(dbPath());
  library = new Library(db, libraryDir());
  settings = new SettingsStore(db);
  analytics = new AnalyticsStore(db);
  sites = new SitesStore(db);
  await library.init();

  const libRoot = normalize(libraryDir() + sep);
  protocol.handle("zenith", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "lib") {
      return new Response("not found", { status: 404 });
    }
    const decoded = decodeURIComponent(url.pathname);
    const target = normalize(join(libraryDir(), decoded));
    if (!target.startsWith(libRoot)) {
      return new Response("forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });

  ipcMain.handle("app:info", (): AppInfo => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    dbPath: dbPath(),
    libraryDir: libraryDir(),
    imageCount: db ? countImages(db) : 0,
  }));

  ipcMain.handle("dialog:pickImages", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import images",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "tif", "tiff", "webp", "fit", "fits", "fts"],
        },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("images:import", (_e, paths: string[]) => library!.importPaths(paths));
  ipcMain.handle("images:list", () => library!.list());
  ipcMain.handle("images:get", (_e, id: number) => library!.getDetail(id));
  ipcMain.handle("images:updateMeta", (_e, id: number, meta: Partial<ImageUserMeta>) =>
    library!.updateMeta(id, meta),
  );
  ipcMain.handle("images:updateNotes", (_e, id: number, notes: string | null) =>
    library!.updateNotes(id, notes),
  );
  ipcMain.handle("images:delete", (_e, id: number) => library!.delete(id));
  ipcMain.handle("images:resolveTargets", (_e, id: number) =>
    library!.resolveTargetsForImage(id),
  );

  ipcMain.handle("settings:get", () => settings!.get());
  ipcMain.handle("settings:set", (_e, partial: Partial<Settings>) =>
    settings!.set(partial),
  );
  ipcMain.handle("dialog:pickBinary", async () => {
    const res = await dialog.showOpenDialog({
      title: "Select solver binary",
      properties: ["openFile"],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle("analytics:get", () => analytics!.compute());

  ipcMain.handle("sites:list", () => sites!.list());
  ipcMain.handle("sites:create", (_e, s: Omit<SiteRow, "id">) => sites!.create(s));
  ipcMain.handle("sites:update", (_e, s: SiteRow) => sites!.update(s));
  ipcMain.handle("sites:delete", (_e, id: number) => sites!.delete(id));

  ipcMain.handle("images:solve", async (_e, id: number, kind?: SolverKind) => {
    const cfg = settings!.get();
    const chosen = kind ?? cfg.preferredSolver;
    const bin =
      chosen === "astap" ? cfg.astapBinPath : cfg.astrometryBinPath;
    if (!bin) throw new Error(`${chosen} binary path is not configured`);
    return library!.solveImage(id, chosen, bin);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  db?.close();
  db = null;
  if (process.platform !== "darwin") app.quit();
});
