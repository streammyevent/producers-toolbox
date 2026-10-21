// The built-in tools: their manifests, their api.js modules and their windows.
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, type WebContents } from "electron";
import { readManifest, type ToolManifest } from "./manifest";
import { preload, toolsDir } from "./paths";

export type ToolMethod = (ctx: ToolContext, ...args: unknown[]) => unknown;

export interface Tool extends ToolManifest {
  dir: string;
  /** The only folder served at app://<id>/. */
  webDir: string;
  api: Readonly<Record<string, ToolMethod>> | null;
}

export interface LauncherTool {
  id: string;
  name: string;
  version: string | null;
  running: boolean;
  icon: string | null;
}

const tools = new Map<string, Tool>();
const windows = new Map<string, BrowserWindow>();
const owners = new Map<number, string>(); // webContents id -> tool id

function loadApi(dir: string): Tool["api"] {
  const file = path.join(dir, "api.js");
  if (!fs.existsSync(file)) return null;
  const mod: unknown = require(file);
  if (!mod || typeof mod !== "object") throw new Error("api.js must export an object of methods");
  const entries = Object.entries(mod);
  if (!entries.every(([, fn]) => typeof fn === "function")) throw new Error("api.js may only export functions");
  return Object.freeze(Object.fromEntries(entries) as Record<string, ToolMethod>);
}

// Built-in tools only: a broken tool.json or api.js is a bug in this build, so it stops the app instead of
// being skipped.
export function loadTools(): void {
  tools.clear();
  const root = toolsDir();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, "tool.json"))) continue;
    try {
      const manifest = readManifest(dir, entry.name);
      tools.set(manifest.id, { ...manifest, dir, webDir: path.join(dir, "web"), api: loadApi(dir) });
    } catch (err) {
      throw new Error(`Tool "${entry.name}": ${(err as Error).message}`, { cause: err });
    }
  }
}

export const getTool = (id: string) => tools.get(id);
export const allTools = () => [...tools.values()];

/** The tool that owns this web contents (one of its windows), if any. */
export function ownerOf(contents: WebContents): Tool | undefined {
  const id = owners.get(contents.id);
  return id === undefined ? undefined : tools.get(id);
}

/** Launcher view of the tools; hidden ones are left out. */
export function listTools(hidden: string[]): LauncherTool[] {
  const skip = new Set(hidden);
  return allTools()
    .filter((t) => !skip.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version,
      running: windows.has(t.id),
      icon: t.icon ? `app://${t.id}/${t.icon}` : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function startTool(id: string, onChange: () => void): void {
  const tool = tools.get(id);
  if (!tool) throw new Error(`Unknown tool: ${id}`);
  const existing = windows.get(id);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  const win = new BrowserWindow({
    width: tool.window.width,
    height: tool.window.height,
    title: tool.name,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preload("tool-preload"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  const contentsId = win.webContents.id;
  windows.set(id, win);
  owners.set(contentsId, id);
  win.on("closed", () => {
    windows.delete(id);
    owners.delete(contentsId);
    onChange();
  });
  win.loadURL(`app://${id}/${tool.entry}`);
  onChange();
}

export function stopTool(id: string): void {
  windows.get(id)?.close();
}

/** Closes a tool's window and waits until it is gone (before deleting its data). */
export function stopAndWait(id: string): Promise<void> {
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    win.once("closed", () => resolve());
    win.destroy();
  });
}

export function stopAll(): void {
  for (const win of windows.values()) win.close();
}
