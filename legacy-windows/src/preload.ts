import { contextBridge, ipcRenderer } from "electron";

// The renderer gets the report and nothing else. This is also the shape the real
// edition would use for every command: one channel, arguments in, JSON out.
contextBridge.exposeInMainWorld("probe", {
  report: () => ipcRenderer.invoke("probe:report"),
});
