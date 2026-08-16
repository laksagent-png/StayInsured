/**
 * The only opening between the interface and the machine.
 *
 * Context isolation is on and Node is off in the renderer, so the screens reach
 * the backend through exactly the functions listed here and nothing else. The
 * command name is a string the main process looks up in its own table, which is
 * what keeps a renderer from naming a function to call.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stayinsured", {
  invoke: (command: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke("app:invoke", command, args),

  /** Returns its own remover, which is what `listen()` resolves to in Tauri. */
  on: (event: string, handler: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on(`app:event:${event}`, listener);
    return () => ipcRenderer.removeListener(`app:event:${event}`, listener);
  },

  version: () => ipcRenderer.invoke("app:version"),
  isWindowVisible: () => ipcRenderer.invoke("app:window-visible"),
  openDialog: (options: unknown) => ipcRenderer.invoke("app:open-dialog", options),
  saveDialog: (options: unknown) => ipcRenderer.invoke("app:save-dialog", options),
  ask: (message: string, options: unknown) => ipcRenderer.invoke("app:ask", message, options),
  autostart: {
    isEnabled: () => ipcRenderer.invoke("app:autostart", "status"),
    enable: () => ipcRenderer.invoke("app:autostart", "enable"),
    disable: () => ipcRenderer.invoke("app:autostart", "disable"),
  },
  relaunch: () => ipcRenderer.invoke("app:relaunch"),
});

// The probe window still has its own channel, because the probe is still the
// thing that answers whether any of this runs on Windows 7 at all.
contextBridge.exposeInMainWorld("probe", {
  report: () => ipcRenderer.invoke("probe:report"),
});
