/**
 * The keyholder page.
 *
 * Two jobs. It serves sealed frames to whatever embedded it, over a private
 * channel handed in at load. And it runs the pairing flow, which needs the
 * camera and so must happen in this window rather than in the frame.
 *
 * See docs/adr/0001-ble-transport-and-key-custody.md.
 */

import { parseShareQr, redact, type SharedKey } from "../ble/share-qr.js";
import {
  createPasskey,
  deriveFor,
  deriveFromPassphrase,
  deriveFromPrf,
  isWebAuthnAvailable,
  PBKDF2_ITERATIONS,
} from "./kek.js";
import { isScanningSupported, scanQrCode } from "./scan.js";
import { KeyholderServer, type KeyholderBackend } from "./server.js";
import { IndexedDbStorage } from "./storage.js";
import { normalizeDeviceName, Vault, type PairedRecord } from "./vault.js";

const vault = new Vault(new IndexedDbStorage());

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The keyholder page is missing #${id}.`);
  return found as T;
};

const status = (text: string, kind: "info" | "error" = "info"): void => {
  const bar = element("status");
  bar.textContent = text;
  bar.dataset.kind = kind;
};

const backend: KeyholderBackend = {
  isPaired: (deviceName) => vault.has(deviceName),
  unlock: async (deviceName) => {
    const protection = await vault.protectionFor(deviceName);
    status(
      protection.kind === "webauthn-prf"
        ? `Confirm to unlock "${deviceName}".`
        : `Enter the passphrase for "${deviceName}".`,
    );
    const kek = await deriveFor(protection, askPassphrase);
    const secret = await vault.unlock(deviceName, kek);
    status(`Session open for "${deviceName}".`);
    return secret;
  },
  pair: async () => {
    // A frame cannot open the camera, so pairing runs here and the embedder is
    // told to bring this window forward.
    throw new Error(
      "Open the keyholder page itself to pair a Sesame, then return to TurboWarp.",
    );
  },
};

const server = new KeyholderServer(backend);

/**
 * Accepts the channel from whoever embedded this page.
 *
 * The port arrives on a message the embedder sends to this frame; taking the
 * port rather than talking over `window.postMessage` means every later message
 * is private to the two ends.
 */
window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { sesameKeyholder?: number } | null;
  const port = event.ports[0];
  if (data?.sesameKeyholder !== 1 || port === undefined) return;
  server.listen(port);
  element("embedded").hidden = false;
});

async function askPassphrase(): Promise<string> {
  const value = element<HTMLInputElement>("passphrase").value;
  if (value.length === 0) {
    element("passphrase-row").hidden = false;
    throw new Error("Enter the passphrase above, then try again.");
  }
  return Promise.resolve(value);
}

async function refresh(): Promise<void> {
  const list = element("devices");
  const devices = await vault.list();
  list.replaceChildren(...devices.map((device) => renderDevice(device)));
  element("empty").hidden = devices.length > 0;
}

function renderDevice(device: PairedRecord): HTMLElement {
  const row = document.createElement("li");
  const name = document.createElement("strong");
  name.textContent = device.deviceName;
  const detail = document.createElement("span");
  detail.textContent = `${device.uuid}${device.level === undefined ? "" : ` · ${device.level} key`}`;
  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = "Forget";
  forget.addEventListener("click", () => {
    void (async () => {
      await vault.forget(device.deviceName);
      status(`Forgot "${device.deviceName}".`);
      await refresh();
    })();
  });
  row.append(name, detail, forget);
  return row;
}

/** Turns scanned or pasted text into a stored, wrapped key. */
async function storeScanned(text: string): Promise<void> {
  let key: SharedKey;
  try {
    key = parseShareQr(text);
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  const alias = normalizeDeviceName(
    element<HTMLInputElement>("alias").value || (key.name ?? "sesame"),
  );

  const usePasskey =
    isWebAuthnAvailable() && element<HTMLInputElement>("use-passkey").checked;
  try {
    if (usePasskey) {
      status("Confirm with your passkey to protect this key.");
      const { credentialId, salt } = await createPasskey(alias);
      const kek = await deriveFromPrf(credentialId, salt);
      await vault.pair(alias, key, kek, {
        kind: "webauthn-prf",
        credentialId,
        salt,
      });
    } else {
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const kek = await deriveFromPassphrase(
        await askPassphrase(),
        salt,
        PBKDF2_ITERATIONS,
      );
      await vault.pair(alias, key, kek, {
        kind: "passphrase",
        salt,
        iterations: PBKDF2_ITERATIONS,
      });
    }
    status(`Paired "${alias}" (${redact(key).uuid}).`);
    element<HTMLInputElement>("paste").value = "";
    element<HTMLInputElement>("passphrase").value = "";
    await refresh();
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), "error");
  }
}

function wire(): void {
  element("scan").addEventListener("click", () => {
    void (async () => {
      const preview = element<HTMLVideoElement>("preview");
      try {
        status("Point the camera at the sharing QR code.");
        const scan = await scanQrCode();
        preview.srcObject = scan.stream;
        preview.hidden = false;
        await preview.play();
        const text = await scan.result;
        preview.hidden = true;
        preview.srcObject = null;
        await storeScanned(text);
      } catch (error) {
        preview.hidden = true;
        preview.srcObject = null;
        status(error instanceof Error ? error.message : String(error), "error");
      }
    })();
  });

  element("use-pasted").addEventListener("click", () => {
    void storeScanned(element<HTMLInputElement>("paste").value);
  });

  element<HTMLInputElement>("use-passkey").addEventListener("change", () => {
    element("passphrase-row").hidden =
      element<HTMLInputElement>("use-passkey").checked;
  });
}

async function start(): Promise<void> {
  wire();
  const passkeys = isWebAuthnAvailable();
  const checkbox = element<HTMLInputElement>("use-passkey");
  checkbox.checked = passkeys;
  checkbox.disabled = !passkeys;
  element("passphrase-row").hidden = passkeys;
  element("no-passkeys").hidden = passkeys;
  element("scan").hidden = !(await isScanningSupported());
  element("no-camera").hidden = !element("scan").hidden;
  await refresh();
  status("Ready.");
}

void start().catch((error: unknown) => {
  status(error instanceof Error ? error.message : String(error), "error");
});
