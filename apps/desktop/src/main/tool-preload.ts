// window.toolbox for tool pages: the whole contract (src/types/toolbox.d.ts). Everything goes through sender-checked
// IPC (ipc.ts); the main process knows which tool is calling from the window and page, not from these arguments.
import { contextBridge, ipcRenderer } from "electron";

/** ipcRenderer.invoke, with Electron's "Error invoking remote method ..." prefix taken off the message. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    const message = String((err as Error)?.message ?? err).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      "",
    );
    throw new Error(message);
  }
}

const toolbox: Toolbox = {
  platform: process.platform,
  close: () => invoke("tool:close"),
  secrets: {
    getAll: () => invoke("secrets:getAll"),
    set: (name, value) => invoke("secrets:set", name, value),
    remove: (name) => invoke("secrets:remove", name),
  },
  folder: {
    get: () => invoke("folder:get"),
    choose: () => invoke("folder:choose"),
    clear: () => invoke("folder:clear"),
    write: (name, content) => invoke("folder:write", name, content),
    read: (name) => invoke("folder:read", name),
    list: () => invoke("folder:list"),
    reveal: (name) => invoke("folder:reveal", name),
  },
  call: (method, ...args) => invoke("tool:call", String(method), args),
};

contextBridge.exposeInMainWorld("toolbox", toolbox);
