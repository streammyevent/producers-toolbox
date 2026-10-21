// Encrypted per-tool secrets (API keys, tokens). Values are encrypted with the OS keychain (Electron safeStorage:
// Keychain on macOS, DPAPI on Windows) and kept in <dir>/<tool id>.json, so a copy of the user-data folder on another
// machine or account cannot read them. A tool may only use the names it lists under "secrets" in tool.json.
// When the OS cannot really encrypt, the store says so and refuses to save: there is no plaintext fallback.
import fs from "node:fs";
import path from "node:path";

const MAX_LENGTH = 4096;
const FILE_VERSION = 1;

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface SecretOwner {
  id: string;
  secrets: string[];
}

export function createSecretStore({
  dir,
  safeStorage,
  platform = process.platform,
}: {
  dir: string;
  safeStorage: SafeStorageLike;
  platform?: NodeJS.Platform;
}) {
  const fileFor = (owner: SecretOwner) => path.join(dir, `${owner.id}.json`);

  /** Linux counts only with a real keyring: the basic_text backend uses a hardcoded password. */
  function available(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (platform === "linux") {
        const backend = safeStorage.getSelectedStorageBackend?.();
        if (backend === "basic_text" || backend === "unknown") return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function readRaw(owner: SecretOwner): Record<string, unknown> {
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(owner), "utf8"));
      const values = parsed && typeof parsed === "object" ? parsed.values : null;
      return values && typeof values === "object" && !Array.isArray(values) ? values : {};
    } catch {
      return {};
    }
  }

  /** name -> base64 ciphertext, allowlisted names only. */
  function read(owner: SecretOwner): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, cipher] of Object.entries(readRaw(owner))) {
      if (owner.secrets.includes(name) && typeof cipher === "string" && cipher) out[name] = cipher;
    }
    return out;
  }

  function write(owner: SecretOwner, values: Record<string, string>): void {
    const target = fileFor(owner);
    const temp = `${target}.${process.pid}.tmp`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify({ version: FILE_VERSION, values }), { mode: 0o600 });
    fs.renameSync(temp, target);
  }

  function assertName(owner: SecretOwner, name: unknown): asserts name is string {
    if (typeof name !== "string" || !owner.secrets.includes(name)) throw new Error("Unknown secret name");
  }

  function decrypt(cipher: string): string | null {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, "base64"));
    } catch {
      return null; // e.g. copied from another user or machine: the user enters it again
    }
  }

  return {
    available,

    getAll(owner: SecretOwner): { available: boolean; values: Record<string, string> } {
      if (!available()) return { available: false, values: {} };
      const values: Record<string, string> = {};
      for (const [name, cipher] of Object.entries(read(owner))) {
        const plain = decrypt(cipher);
        if (plain !== null) values[name] = plain;
      }
      return { available: true, values };
    },

    /** For the tool's api.js: one value, or null. */
    get(owner: SecretOwner, name: string): string | null {
      assertName(owner, name);
      if (!available()) return null;
      const cipher = read(owner)[name];
      return cipher ? decrypt(cipher) : null;
    },

    set(owner: SecretOwner, name: unknown, value: unknown): true {
      assertName(owner, name);
      if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
        throw new Error("Invalid secret value");
      }
      if (!available()) throw new Error("Encrypted storage is not available on this system");
      const values = read(owner);
      values[name] = safeStorage.encryptString(value).toString("base64");
      write(owner, values);
      return true;
    },

    remove(owner: SecretOwner, name: unknown): true {
      assertName(owner, name);
      const values = read(owner);
      if (name in values) {
        delete values[name];
        write(owner, values);
      }
      return true;
    },

    /** Drops stored names the tool no longer lists. */
    purge(owner: SecretOwner): void {
      const stored = Object.keys(readRaw(owner));
      if (stored.some((name) => !owner.secrets.includes(name))) write(owner, read(owner));
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;
