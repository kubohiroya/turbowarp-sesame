/**
 * Where the keyholder keeps wrapped device keys.
 *
 * Only wrapped bytes and public identifiers pass through here. The wrapping key
 * is never stored: it is re-derived per session from a platform authenticator
 * or a passphrase.
 */

export interface VaultRecord {
  /** Alias the extension refers to this device by. */
  deviceName: string;
  /** Device UUID from the sharing QR code, for showing which lock this is. */
  uuid: string;
  /** Product model byte. */
  model: number;
  /** The device's public key, hexadecimal. Not a secret. */
  publicKey: string;
  /** Advisory key level the QR code claimed. Never used as a permission. */
  level?: string;
  /** The device secret, wrapped under the key-encryption key. */
  wrappedSecret: Uint8Array;
  /** AES-GCM initialization vector for {@link wrappedSecret}. */
  wrapIv: Uint8Array;
  /** How the key-encryption key is derived. */
  protection: Protection;
  pairedAt: number;
}

export type Protection =
  | { kind: "webauthn-prf"; credentialId: Uint8Array; salt: Uint8Array }
  | { kind: "passphrase"; salt: Uint8Array; iterations: number };

export interface VaultStorage {
  get(deviceName: string): Promise<VaultRecord | undefined>;
  put(record: VaultRecord): Promise<void>;
  list(): Promise<VaultRecord[]>;
  delete(deviceName: string): Promise<void>;
}

const DATABASE_NAME = "sesame-keyholder";
const STORE_NAME = "devices";
const VERSION = 1;

/** Browser storage. Records live in this origin only. */
export class IndexedDbStorage implements VaultStorage {
  private database: Promise<IDBDatabase> | undefined;

  public async get(deviceName: string): Promise<VaultRecord | undefined> {
    return this.run("readonly", (store) => store.get(deviceName)) as Promise<
      VaultRecord | undefined
    >;
  }

  public async put(record: VaultRecord): Promise<void> {
    await this.run("readwrite", (store) => store.put(record));
  }

  public async list(): Promise<VaultRecord[]> {
    return (await this.run("readonly", (store) =>
      store.getAll(),
    )) as VaultRecord[];
  }

  public async delete(deviceName: string): Promise<void> {
    await this.run("readwrite", (store) => store.delete(deviceName));
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, {
          keyPath: "deviceName",
        });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(
          new Error(
            "This browser will not store keys. Private windows and blocked site data prevent it.",
          ),
        );
      };
    });
    return this.database;
  }

  private async run(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    const database = await this.open();
    return new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error("The keyholder could not reach its storage."));
      };
    });
  }
}

/** In-memory storage, for tests and for a deliberately forgetful session. */
export class MemoryStorage implements VaultStorage {
  private readonly records = new Map<string, VaultRecord>();

  public get(deviceName: string): Promise<VaultRecord | undefined> {
    return Promise.resolve(this.records.get(deviceName));
  }

  public put(record: VaultRecord): Promise<void> {
    this.records.set(record.deviceName, record);
    return Promise.resolve();
  }

  public list(): Promise<VaultRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  public delete(deviceName: string): Promise<void> {
    this.records.delete(deviceName);
    return Promise.resolve();
  }
}
