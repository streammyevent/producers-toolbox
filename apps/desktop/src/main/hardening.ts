// App-wide rules for every web contents: no webviews, no navigation away from the page's own app:// host, new
// windows only as http(s) links in the system browser, and only the permissions a tool lists in tool.json.
import { app, Menu, session, shell, type MenuItemConstructorOptions, type WebContents } from "electron";
import type { ToolPermission } from "./manifest";
import type { Tool } from "./tools";

function isHttpUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hostOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "app:" ? url.host : null;
  } catch {
    return null;
  }
}

/** A page may only move within its own app:// host (a tool within its tool, the launcher within app://shell). */
function staysHome(contents: WebContents, target: string): boolean {
  const home = hostOf(contents.getURL());
  return home !== null && hostOf(target) === home;
}

function blockLeaving(contents: WebContents) {
  return (event: Electron.Event, url: string) => {
    if (staysHome(contents, url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  };
}

// Permissions every page gets: writing to the clipboard (copy buttons) and full screen.
const ALWAYS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "fullscreen"]);

function allowed(
  tool: Tool | undefined,
  permission: string,
  requestingUrl: string,
  mediaTypes: readonly string[] = [],
): boolean {
  if (ALWAYS.has(permission)) return true;
  if (!tool || hostOf(requestingUrl) !== tool.id) return false;
  const has = (p: ToolPermission) => tool.permissions.includes(p);
  if (permission === "media") return has("camera") && mediaTypes.length > 0 && mediaTypes.every((t) => t === "video");
  if (permission === "clipboard-read") return has("clipboard-read");
  return false;
}

export function harden({ ownerOf }: { ownerOf: (contents: WebContents) => Tool | undefined }): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-navigate", blockLeaving(contents));
    contents.on("will-redirect", blockLeaving(contents));
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    if (app.isPackaged) contents.on("devtools-opened", () => contents.closeDevTools());
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(allowed(ownerOf(contents), permission, details.requestingUrl, mediaTypes));
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const mediaTypes = details.mediaType ? [details.mediaType] : [];
    return allowed(
      contents ? ownerOf(contents) : undefined,
      permission,
      details.requestingUrl ?? requestingOrigin,
      mediaTypes,
    );
  });
  ses.setDevicePermissionHandler(() => false);
}

/** Standard menus with copy and paste (macOS needs an Edit menu for them); developer tools only in development. */
export function buildMenu(): Menu {
  const view: MenuItemConstructorOptions[] = [
    { role: "reload" },
    ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as const]),
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" } as const] : [{ role: "fileMenu" } as const]),
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}
