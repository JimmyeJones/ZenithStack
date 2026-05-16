import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase, countImages } from "./db";
import type { AppInfo } from "../shared/ipc";

const isDev = !app.isPackaged;

let db: Database.Database | null = null;

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
    win.loadFile(join(__dirname, "../dist/index.html"));
  }
}

function dbPath(): string {
  return join(app.getPath("userData"), "zenithstack.db");
}

app.whenReady().then(() => {
  db = openDatabase(dbPath());

  ipcMain.handle("app:info", (): AppInfo => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      dbPath: dbPath(),
      imageCount: db ? countImages(db) : 0,
    };
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
