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
};

contextBridge.exposeInMainWorld("zenith", api);
