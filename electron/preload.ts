import { contextBridge, ipcRenderer } from "electron";
import type { ZenithApi } from "../shared/ipc";

const api: ZenithApi = {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
};

contextBridge.exposeInMainWorld("zenith", api);
