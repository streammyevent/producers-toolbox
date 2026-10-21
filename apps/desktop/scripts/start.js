// Starts Electron with ELECTRON_RUN_AS_NODE removed. Some editors and terminals set it,
// which makes Electron behave like plain Node and crash on require('electron').
const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { stdio: "inherit", env, cwd: __dirname + "/.." });
child.on("exit", (code) => process.exit(code ?? 0));
