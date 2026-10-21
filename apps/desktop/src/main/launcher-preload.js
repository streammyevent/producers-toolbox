const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolbox", {
  listTools: () => ipcRenderer.invoke("tools:list"),
  start: (id) => ipcRenderer.invoke("tools:start", id),
  stop: (id) => ipcRenderer.invoke("tools:stop", id),
  removeTool: (id) => ipcRenderer.invoke("tools:remove", id),
  updateStatus: () => ipcRenderer.invoke("updates:status"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  restartToUpdate: () => ipcRenderer.invoke("updates:restart"),
  onUpdateStatus: (cb) => ipcRenderer.on("updates:status", (_e, s) => cb(s)),
  uninstall: () => ipcRenderer.invoke("app:uninstall"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  appInfo: () => ipcRenderer.invoke("app:info"),
  quit: () => ipcRenderer.invoke("app:quit"),
  onChange: (cb) => ipcRenderer.on("tools:changed", (_e, list) => cb(list)),
});
