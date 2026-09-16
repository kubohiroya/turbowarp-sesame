/**
 * The keyholder page.
 *
 * Two jobs. It serves sealed frames to whatever embedded it, over a private
 * channel handed in at load. And it runs the pairing flow, which needs the
 * camera and so must happen in this window rather than in the frame.
 *
 * See docs/adr/0001-ble-transport-and-key-custody.md.
 */

import {
  parseShareQr,
  redact,
  sharedKeyFromParts,
  type SharedKey,
} from "../ble/share-qr.js";
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
import {
  normalizeDeviceName,
  suggestDeviceName,
  Vault,
  type PairedRecord,
} from "./vault.js";

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

/**
 * Tells whoever opened this window that it is ready for a channel.
 *
 * A cross-origin opener gets no load event for this document, so without an
 * announcement it can only guess when to offer its port. The message carries
 * nothing but the fact of being ready, which is why posting it to any origin
 * is safe: the opener's origin is not known here, and the channel itself is
 * established the other way round, addressed to this origin.
 */
if (window.opener !== null) {
  window.opener.postMessage({ sesameKeyholder: "ready" }, "*");
}

/**
 * Warns when this page is embedded rather than opened.
 *
 * Chrome partitions storage for a cross-site frame, so an embedded copy sees
 * an empty store instead of the keys paired here — which reads as "no Sesame
 * is paired" and looks like the pairing failed. Saying so plainly is better
 * than leaving someone to pair again into a store nothing will read.
 */
if (window.top !== window.self) {
  status(
    "This keyholder is embedded in another page, where the browser gives it separate storage. Keys paired here are not visible to it.",
    "error",
  );
}

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
  const parts = [
    device.uuid ?? "UUID not in the sharing code",
    ...(device.level === undefined ? [] : [`${device.level} key`]),
  ];
  detail.textContent = parts.join(" · ");
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
  await store(key);
}

/** Turns values typed in by hand into a stored, wrapped key. */
async function storeManual(): Promise<void> {
  let key: SharedKey;
  try {
    key = sharedKeyFromParts({
      secret: element<HTMLInputElement>("manual-secret").value,
      uuid: element<HTMLInputElement>("manual-uuid").value,
    });
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), "error");
    return;
  }
  await store(key);
  element<HTMLInputElement>("manual-secret").value = "";
}

async function store(key: SharedKey): Promise<void> {
  const usePasskey =
    isWebAuthnAvailable() && element<HTMLInputElement>("use-passkey").checked;
  try {
    // Inside the try, because only the scan path had its own error handling:
    // a rejected alias was reported there and swallowed everywhere else.
    //
    // A typed alias is taken at its word, so a mistake in it is reported
    // against what was typed. An empty field falls back to the name from the
    // code, which is a label chosen for people and often cannot be an alias.
    const typed = element<HTMLInputElement>("alias").value.trim();
    const alias = normalizeDeviceName(
      typed.length > 0 ? typed : suggestDeviceName(key.name),
    );

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
    const uuid = redact(key).uuid;
    status(
      uuid === undefined
        ? `Paired "${alias}". The sharing code carried no device UUID, which Bluetooth does not need.`
        : `Paired "${alias}" (${uuid}).`,
    );
    element<HTMLInputElement>("paste").value = "";
    element<HTMLInputElement>("passphrase").value = "";
    await refresh();
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), "error");
  }
}

/**
 * Like {@link element}, but for a control the page may not carry.
 *
 * A control that has gone missing should disable one route, not take the whole
 * page down with it — which is exactly what happened when the manual entry
 * markup and the code that wires it went out of step.
 */
const optional = <T extends HTMLElement>(id: string): T | undefined =>
  (document.getElementById(id) as T | null) ?? undefined;

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

  optional("use-manual")?.addEventListener("click", () => {
    void storeManual();
  });

  element<HTMLInputElement>("use-passkey").addEventListener("change", () => {
    element("passphrase-row").hidden =
      element<HTMLInputElement>("use-passkey").checked;
  });
}

/**
 * Registers the service worker that caches this page.
 *
 * Without it, a host that is down or unreachable means a lock that cannot be
 * opened, even though Bluetooth itself needs no network. Registration failing
 * is not an error worth showing: the page works, it just needs the network
 * each time.
 */
function cacheThisPage(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
    // Private windows, blocked site data, and insecure origins all land here.
  });
}

async function start(): Promise<void> {
  wire();
  cacheThisPage();
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
