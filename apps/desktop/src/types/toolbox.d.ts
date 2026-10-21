// The contract between the shell and a tool. Tool pages get `window.toolbox` (tool-preload.ts); a tool's api.js
// gets a ToolContext as the first argument of every method. Tools type-check their JavaScript against this file.

interface ToolboxSecrets {
  /** `available` is false when the OS cannot encrypt; `values` then is empty and `set` rejects. */
  getAll(): Promise<{ available: boolean; values: Record<string, string> }>;
  /** Only names listed under "secrets" in tool.json. */
  set(name: string, value: string): Promise<true>;
  remove(name: string): Promise<true>;
}

interface ToolboxFolderStatus {
  /** Absolute path of the folder, or "" when none is chosen. */
  folder: string;
  name: string;
  accessible: boolean;
}

interface ToolboxFile {
  name: string;
  modifiedTime: string;
  size: number;
}

/** The folder the user picked for this tool (tool.json "folder"). The page passes file names, never paths. */
interface ToolboxFolder {
  get(): Promise<ToolboxFolderStatus>;
  /** Opens a folder dialog; null when the user cancels. */
  choose(): Promise<ToolboxFolderStatus | null>;
  clear(): Promise<ToolboxFolderStatus>;
  write(name: string, content: string): Promise<true>;
  read(name: string): Promise<string>;
  list(): Promise<ToolboxFile[]>;
  reveal(name?: string): Promise<true>;
}

interface Toolbox {
  platform: string;
  /** Closes this tool's window. */
  close(): Promise<void>;
  secrets: ToolboxSecrets;
  folder: ToolboxFolder;
  /** Calls a method exported by this tool's api.js. */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
}

interface Window {
  toolbox?: Toolbox;
}

interface ToolFetchResult {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

interface ToolFetchOptions {
  headers?: Record<string, string>;
  /** Default 5 MB. Larger responses are refused, or cut off when `truncate` is set. */
  maxBytes?: number;
  truncate?: boolean;
  /** Default 15 s. */
  timeoutMs?: number;
}

interface ToolFolderStore {
  status(): ToolboxFolderStatus;
  /** The chosen folder, ready to use. Throws when none is chosen or it is not reachable. */
  requireFolder(): string;
}

/** What a tool's api.js methods receive. */
interface ToolContext {
  toolId: string;
  /** Private per-tool data folder (created on first write). */
  dataDir: string;
  /** Documents/Producers Toolbox, for files the user should find. */
  documentsDir: string;
  /** The folder the user picked for this tool, or null when tool.json has no "folder". */
  folder: ToolFolderStore | null;
  /** Only names listed under "secrets" in tool.json. `set` throws when the OS cannot encrypt. */
  secrets: { get(name: string): string | null; set(name: string, value: string): true };
  /** fetch for public internet addresses only (no local network), with size and time limits. */
  net: { fetchPublic(url: string, options?: ToolFetchOptions): Promise<ToolFetchResult> };
}
