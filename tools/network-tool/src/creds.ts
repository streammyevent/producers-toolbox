export type Creds = { switchUser: string; switchPass: string; unifiUser: string; unifiPass: string };

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString("base64");
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

async function deriveKey(code: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(creds: Creds, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveKey(code, salt),
    new TextEncoder().encode(JSON.stringify(creds)),
  );
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

/** Throws when the code is wrong (GCM tag mismatch). */
export async function unseal(file: string, code: string): Promise<Creds> {
  const { salt, iv, data } = JSON.parse(file);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await deriveKey(code, unb64(salt)),
    unb64(data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
