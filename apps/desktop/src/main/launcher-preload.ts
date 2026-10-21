import { contextBridge, ipcRenderer } from "electron";

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("launcher", {
  listTools: () => invoke("launcher:list-tools"),
  start: (id: string) => invoke("launcher:start-tool", id),
  stop: (id: string) => invoke("launcher:stop-tool", id),
  removeTool: (id: string) => invoke("launcher:remove-tool", id),
  getSettings: () => invoke("settings:get"),
  setSettings: (patch: unknown) => invoke("settings:set", patch),
  appInfo: () => invoke("app:info"),
  uninstall: () => invoke("app:uninstall"),
  quit: () => invoke("app:quit"),
  updateStatus: () => invoke("updates:status"),
  checkUpdates: () => invoke("updates:check"),
  restartToUpdate: () => invoke("updates:restart"),
  onUpdateStatus: (cb: (status: unknown) => void) => ipcRenderer.on("updates:status", (_e, s) => cb(s)),
  onChange: (cb: (tools: unknown) => void) => ipcRenderer.on("tools:changed", (_e, list) => cb(list)),
});
