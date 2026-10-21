import path from "node:path";
import { app } from "electron";

// Compiled code runs from out/main; the packaged app has the same layout inside app.asar.
const appRoot = path.join(__dirname, "..", "..");

// Tools live in the repo's tools/ folder; packaged builds copy them into the app as tools/.
export const toolsDir = () => (app.isPackaged ? path.join(appRoot, "tools") : path.join(appRoot, "..", "..", "tools"));

export const rendererDir = () => path.join(appRoot, "src", "renderer");

export const preload = (name: "tool-preload" | "launcher-preload") => path.join(__dirname, `${name}.js`);
