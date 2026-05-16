import { contextBridge, ipcRenderer } from "electron";
import type { ZenithApi } from "../shared/ipc";

const api: ZenithApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  pickImageFiles: () => ipcRenderer.invoke("dialog:pickImages"),
  importImages: (paths) => ipcRenderer.invoke("images:import", paths),
  listImages: () => ipcRenderer.invoke("images:list"),
  getImage: (id) => ipcRenderer.invoke("images:get", id),
  updateImageMeta: (id, meta) => ipcRenderer.invoke("images:updateMeta", id, meta),
  updateImageNotes: (id, notes) => ipcRenderer.invoke("images:updateNotes", id, notes),
  deleteImage: (id) => ipcRenderer.invoke("images:delete", id),
  resolveTargets: (id) => ipcRenderer.invoke("images:resolveTargets", id),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (partial) => ipcRenderer.invoke("settings:set", partial),
  pickBinary: () => ipcRenderer.invoke("dialog:pickBinary"),
  plateSolve: (id, kind) => ipcRenderer.invoke("images:solve", id, kind),
  getAnalytics: () => ipcRenderer.invoke("analytics:get"),
};

contextBridge.exposeInMainWorld("zenith", api);
