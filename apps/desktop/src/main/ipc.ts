// Every IPC handler is registered through handleTool or handleLauncher, which check who is calling. The caller is
// taken from the sending window and its top-level page's app:// origin, never from what the page claims.
// A unit test fails when anything else calls ipcMain.handle or ipcMain.on.
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { ownerOf, type Tool } from "./tools";

let launcher: WebContents | null = null;

export function setLauncher(contents: WebContents | null): void {
  launcher = contents;
}

/** Host of the top-level page that sent the message, or null for a subframe or an unparsable URL. */
function topLevelHost(event: IpcMainInvokeEvent): string | null {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return null;
  try {
    const url = new URL(frame.url);
    return url.protocol === "app:" ? url.host : null;
  } catch {
    return null;
  }
}

/** The tool whose own window and own app://<id> page sent this message. */
export function toolFor(event: IpcMainInvokeEvent): Tool | null {
  const tool = ownerOf(event.sender);
  return tool && topLevelHost(event) === tool.id ? tool : null;
}

export function isLauncher(event: IpcMainInvokeEvent): boolean {
  return !!launcher && !launcher.isDestroyed() && event.sender === launcher && topLevelHost(event) === "shell";
}

const blocked = () => new Error("Blocked IPC call from an untrusted sender");

export function handleTool(channel: string, fn: (tool: Tool, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    const tool = toolFor(event);
    if (!tool) throw blocked();
    return fn(tool, ...args);
  });
}

export function handleLauncher(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isLauncher(event)) throw blocked();
    return fn(...args);
  });
}
