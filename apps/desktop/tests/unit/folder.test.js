const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createFolderStore } = require("../../out/main/folder");

const FILES = /^(Backup|RunSheet)_[A-Za-z0-9_-]{1,100}\.(json|csv)$/;

function setup(t, policy = { subfolder: "Speaker Photo Directory", files: FILES, maxBytes: 1000 }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-folder-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let picked = null;
  const store = createFolderStore({
    configPath: path.join(root, "data", "folder.json"),
    policy,
    defaultPath: () => root,
    dialog: {
      showOpenDialog: async () =>
        picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] },
    },
    shell: { showItemInFolder: () => {}, openPath: async () => "" },
  });
  return { root, store, pick: (dir) => (picked = dir) };
}

test("choosing a folder uses the tool's subfolder, or the picked folder when it is that subfolder", async (t) => {
  const { root, store, pick } = setup(t);
  assert.strictEqual(await store.choose(null), null);
  assert.deepStrictEqual(store.status(), { folder: "", name: "", accessible: false });
  pick(path.join(root, "Drive"));
  fs.mkdirSync(path.join(root, "Drive"));
  const st = await store.choose(null);
  assert.strictEqual(st.folder, path.join(root, "Drive", "Speaker Photo Directory"));
  assert.strictEqual(st.accessible, true);
  pick(path.join(root, "Drive", "Speaker Photo Directory"));
  assert.strictEqual((await store.choose(null)).folder, path.join(root, "Drive", "Speaker Photo Directory"));
});

test("reads, writes and lists only allowed names directly inside the folder", async (t) => {
  const { root, store, pick } = setup(t);
  assert.throws(() => store.write("Backup_A.json", "{}"), /No folder chosen/);
  pick(root);
  await store.choose(null);
  store.write("Backup_Show.json", "{}");
  assert.strictEqual(store.read("Backup_Show.json"), "{}");
  fs.writeFileSync(path.join(store.status().folder, "notes.txt"), "not listed");
  assert.deepStrictEqual(
    store.list().map((f) => f.name),
    ["Backup_Show.json"],
  );
  for (const name of ["../Backup_X.json", "Backup_X.exe", "sub/Backup_X.json", "Backup_.json", 42]) {
    assert.throws(() => store.write(name, "{}"), /Invalid file name/, String(name));
  }
  assert.throws(() => store.write("Backup_Big.json", "x".repeat(1001)), /Invalid file content/);
});

test("a missing subfolder is recreated, a missing drive is not", async (t) => {
  const { root, store, pick } = setup(t);
  fs.mkdirSync(path.join(root, "Drive"));
  pick(path.join(root, "Drive"));
  await store.choose(null);
  fs.rmSync(path.join(root, "Drive", "Speaker Photo Directory"), { recursive: true });
  store.write("Backup_A.json", "{}");
  fs.rmSync(path.join(root, "Drive"), { recursive: true });
  assert.throws(() => store.write("Backup_A.json", "{}"), /not available/);
  assert.ok(!fs.existsSync(path.join(root, "Drive")));
});

test("without a files pattern the page cannot use the folder; the tool's own code can", async (t) => {
  const { root, store, pick } = setup(t, { subfolder: null, files: null, maxBytes: 1000 });
  pick(root);
  await store.choose(null);
  assert.strictEqual(store.requireFolder(), root);
  assert.throws(() => store.write("Backup_A.json", "{}"), /cannot read or write/);
  assert.throws(() => store.list(), /cannot read or write/);
});
