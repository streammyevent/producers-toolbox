// A folder the user picks for a tool, normally inside Google Drive for desktop, OneDrive or Dropbox, which does the
// syncing. The path lives in the main process only (<userData>/tools/<id>/folder.json): the page never sends one.
// When tool.json allows it, the page reads, writes and lists file names matching "files", directly inside the folder.
// The tool's api.js gets the folder itself (requireFolder) for its own file layout.
import fs from "node:fs";
import path from "node:path";
import type { BrowserWindow, Dialog, Shell } from "electron";
import type { ToolFolderPolicy } from "./manifest";

const CONFIG_VERSION = 1;

export interface FolderStore extends ToolFolderStore {
  choose(win: BrowserWindow | null): Promise<ToolboxFolderStatus | null>;
  clear(): ToolboxFolderStatus;
  write(name: unknown, content: unknown): true;
  read(name: unknown): string;
  list(): ToolboxFile[];
  reveal(name?: unknown): true;
}

export function createFolderStore({
  configPath,
  policy,
  defaultPath,
  dialog,
  shell,
}: {
  configPath: string;
  policy: ToolFolderPolicy;
  defaultPath: () => string;
  dialog: Pick<Dialog, "showOpenDialog">;
  shell: Pick<Shell, "showItemInFolder" | "openPath">;
}): FolderStore {
  /** The chosen folder (absolute), or "" when none is set. */
  function readFolder(): string {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const folder = parsed && typeof parsed.folder === "string" ? parsed.folder : "";
      return folder && path.isAbsolute(folder) ? path.normalize(folder) : "";
    } catch {
      return "";
    }
  }

  function writeFolder(folder: string): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ version: CONFIG_VERSION, folder }), { mode: 0o600 });
  }

  function isWritableDir(dir: string): boolean {
    try {
      if (!fs.statSync(dir).isDirectory()) return false;
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  function status(): ToolboxFolderStatus {
    const folder = readFolder();
    return { folder, name: folder ? path.basename(folder) : "", accessible: !!folder && isWritableDir(folder) };
  }

  // Recreates the tool's subfolder when only that was removed, but never the folder around it: when a drive letter
  // or cloud mount is missing, it fails instead of writing somewhere else.
  function requireFolder(): string {
    const folder = readFolder();
    if (!folder) throw new Error("No folder chosen");
    if (policy.subfolder && !fs.existsSync(folder) && isWritableDir(path.dirname(folder))) fs.mkdirSync(folder);
    if (!isWritableDir(folder)) throw new Error("The folder is not available: " + folder);
    return folder;
  }

  /** Absolute path of an allowed file name directly inside the folder. */
  function filePath(folder: string, name: unknown): string {
    if (!policy.files) throw new Error("This tool cannot read or write files in its folder");
    if (typeof name !== "string" || !policy.files.test(name)) throw new Error("Invalid file name");
    const full = path.join(folder, name);
    if (path.dirname(full) !== folder) throw new Error("Invalid file name");
    return full;
  }

  return {
    status,
    requireFolder,

    async choose(win) {
      const current = readFolder();
      const options: Electron.OpenDialogOptions = {
        title: "Choose a folder (for example inside Google Drive)",
        buttonLabel: "Use this folder",
        defaultPath: current ? path.dirname(current) : defaultPath(),
        properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (!result || result.canceled || !result.filePaths?.[0]) return null;
      const picked = path.normalize(result.filePaths[0]);
      // Picking the tool's own subfolder (e.g. on a second computer) uses it as is
      const { subfolder } = policy;
      const folder = !subfolder || path.basename(picked) === subfolder ? picked : path.join(picked, subfolder);
      fs.mkdirSync(folder, { recursive: true });
      writeFolder(folder);
      return status();
    },

    clear() {
      fs.rmSync(configPath, { force: true });
      return status();
    },

    write(name, content) {
      const target = filePath(requireFolder(), name);
      if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > policy.maxBytes) {
        throw new Error("Invalid file content");
      }
      // Temp file + rename, so a sync client never uploads a half-written file. The temp name never matches
      // policy.files, so it is not listed.
      const temp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temp, content, "utf8");
      try {
        fs.renameSync(temp, target);
      } catch {
        // A sync client can hold the old file open (Windows EPERM/EBUSY): overwrite it in place instead
        fs.writeFileSync(target, content, "utf8");
        fs.rmSync(temp, { force: true });
      }
      return true;
    },

    read(name) {
      const target = filePath(requireFolder(), name);
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > policy.maxBytes) throw new Error("File is too large or not a file");
      return fs.readFileSync(target, "utf8");
    },

    list() {
      const folder = requireFolder();
      const pattern = policy.files;
      if (!pattern) throw new Error("This tool cannot read or write files in its folder");
      const files: ToolboxFile[] = [];
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!entry.isFile() || !pattern.test(entry.name)) continue;
        try {
          const stat = fs.statSync(path.join(folder, entry.name));
          files.push({ name: entry.name, modifiedTime: stat.mtime.toISOString(), size: stat.size });
        } catch {
          // Removed while listing
        }
      }
      return files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
    },

    reveal(name) {
      const folder = requireFolder();
      const target = name ? filePath(folder, name) : folder;
      if (name && fs.existsSync(target)) shell.showItemInFolder(target);
      else shell.openPath(folder);
      return true;
    },
  };
}
