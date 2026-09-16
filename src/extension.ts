import { featureFlags } from "../config/feature-flags.js";
import definitions from "./block-definitions.json";
import { SesameBleTransport, type BleTransport } from "./ble/ble-transport.js";
import {
  RemoteKeyholder,
  validateKeyholderUrl,
} from "./ble/remote-keyholder.js";
import {
  isWebBluetoothAvailable,
  requestSesameChannel,
} from "./ble/web-bluetooth.js";
import { extensionConfig } from "./config.js";
import {
  pairWithRelay,
  RelayClient,
  validateRelayConfiguration,
  type RelayConfiguration,
  type RelaySession,
} from "./relay-client.js";
import {
  SesameClient,
  type SesameCommand,
  type SesameCredentials,
} from "./sesame-client.js";
import { requireCapability, type SesameTransport } from "./transport.js";

type BlockTypeName = "COMMAND" | "REPORTER" | "BOOLEAN" | "HAT";
type ArgumentTypeName = "STRING" | "NUMBER" | "BOOLEAN";

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string | number | boolean;
  menu?: string;
}

interface BlockDefinition {
  opcode: string;
  blockType: BlockTypeName;
  text: string;
  description: string;
  arguments?: Record<string, DefinitionArgument>;
}

interface MenuDefinition {
  acceptReporters?: boolean;
  items: Array<string | { text: string; value: string }>;
}

const blockDefinitions = definitions.blocks as readonly BlockDefinition[];
const menuDefinitions = definitions.menus as Record<string, MenuDefinition>;

export class SesameExtension implements TurboWarpExtension {
  private connection:
    | { mode: "direct"; credentials: SesameCredentials }
    | {
        mode: "relay";
        configuration: RelayConfiguration;
        session?: RelaySession;
      }
    | {
        mode: "bluetooth";
        keyholderUrl: string;
        deviceAlias: string;
        keyholder?: RemoteKeyholder;
        transport?: BleTransport;
        /**
         * Learned when pairing runs in this session. A Sesame advertises the
         * base64 of its UUID, so knowing it narrows the browser's chooser from
         * every Candy House product in range to the one lock.
         */
        deviceUuid?: string;
      }
    | undefined;
  private lastErrorMessage = "";
  /**
   * Set when the lock reports that it moved, and cleared by the hat block that
   * reads it. Edge-activated hats are polled, so the flag is what carries a
   * push that arrives between polls.
   */
  private stateChanged = false;

  public getInfo(): Record<string, unknown> {
    return {
      id: extensionConfig.id,
      name: Scratch.translate(definitions.extensionName),
      docsURI: extensionConfig.docsURI,
      blockIconURI: extensionConfig.blockIconURI,
      color1: "#e8a51b",
      color2: "#ce8d0e",
      color3: "#ad7408",
      blocks: blockDefinitions.map((block) => this.toScratchBlock(block)),
      menus: menuDefinitions,
    };
  }

  public configure(args: {
    API_KEY: unknown;
    UUID: unknown;
    SECRET_KEY: unknown;
  }): void {
    this.capture(() => {
      const credentials = {
        apiKey: Scratch.Cast.toString(args.API_KEY).trim(),
        uuid: Scratch.Cast.toString(args.UUID).trim().toUpperCase(),
        secretKey: Scratch.Cast.toString(args.SECRET_KEY).trim().toLowerCase(),
      };
      // Construction validates before replacing working credentials.
      new SesameClient(credentials);
      this.connection = { mode: "direct", credentials };
    });
  }

  public configureRelay(args: {
    ENDPOINT: unknown;
    DEVICE_ALIAS: unknown;
  }): void {
    this.capture(() => {
      requireUnsandboxedRelay();
      const configuration = validateRelayConfiguration({
        endpoint: Scratch.Cast.toString(args.ENDPOINT),
        deviceAlias: Scratch.Cast.toString(args.DEVICE_ALIAS),
      });
      this.connection = { mode: "relay", configuration };
    });
  }

  public async pairRelay(args: { CODE: unknown }): Promise<void> {
    await this.captureAsync(async () => {
      if (this.connection?.mode !== "relay") {
        throw new Error("Configure the local relay first.");
      }
      const session = await pairWithRelay(
        this.connection.configuration,
        Scratch.Cast.toString(args.CODE).trim(),
      );
      this.connection = {
        mode: "relay",
        configuration: this.connection.configuration,
        session,
      };
    }, undefined);
  }

  public configureBluetooth(args: {
    KEYHOLDER_URL: unknown;
    DEVICE_ALIAS: unknown;
  }): void {
    this.capture(() => {
      requireUnsandboxedBluetooth();
      const keyholderUrl = validateKeyholderUrl(
        Scratch.Cast.toString(args.KEYHOLDER_URL),
      );
      const deviceAlias = Scratch.Cast.toString(args.DEVICE_ALIAS).trim();
      if (deviceAlias.length === 0) {
        throw new TypeError("Give the Sesame a device alias.");
      }
      void this.releaseBluetooth();
      this.connection = { mode: "bluetooth", keyholderUrl, deviceAlias };
    });
  }

  public async openKeyholder(): Promise<void> {
    await this.captureAsync(async () => {
      const connection = this.requireBluetooth();
      await this.keyholder(connection).ready();
    }, undefined);
  }

  public async pairBluetooth(): Promise<void> {
    await this.captureAsync(async () => {
      const connection = this.requireBluetooth();
      const keyholder = this.keyholder(connection);
      const paired = await keyholder.pair();
      this.connection = {
        ...connection,
        deviceAlias: paired.deviceName,
        ...(paired.uuid === undefined ? {} : { deviceUuid: paired.uuid }),
      };
    }, undefined);
  }

  public async connectBluetooth(): Promise<void> {
    await this.captureAsync(async () => {
      const connection = this.requireBluetooth();
      if (connection.transport?.isLoggedIn() === true) return;
      // Opened before anything awaits, so the chooser still sees the gesture
      // that started this block.
      const channel = await requestSesameChannel(connection.deviceUuid);
      const transport = new SesameBleTransport({
        channel,
        keyholder: this.keyholder(connection),
        deviceName: connection.deviceAlias,
      });
      transport.onStatusChange(() => {
        this.stateChanged = true;
      });
      try {
        await transport.connect();
      } catch (error) {
        await transport.close();
        throw error;
      }
      this.connection = { ...connection, transport };
    }, undefined);
  }

  public bluetoothConnected(): boolean {
    return (
      this.connection?.mode === "bluetooth" &&
      this.connection.transport?.isLoggedIn() === true
    );
  }

  public whenStateChanges(): boolean {
    if (!this.stateChanged) return false;
    this.stateChanged = false;
    return true;
  }

  public clearCredentials(): void {
    void this.releaseBluetooth();
    this.connection = undefined;
    this.lastErrorMessage = "";
    this.stateChanged = false;
  }

  public isConfigured(): boolean {
    return (
      this.connection?.mode === "direct" ||
      this.relayPaired() ||
      this.bluetoothConnected()
    );
  }

  public relayPaired(): boolean {
    return (
      this.connection?.mode === "relay" &&
      this.connection.session !== undefined &&
      this.connection.session.expiresAt > Date.now()
    );
  }

  public connectionMode(): string {
    return this.connection?.mode ?? "not configured";
  }

  public commandsEnabled(): boolean {
    return featureFlags.sesameCommands;
  }

  public async getStatusField(args: {
    FIELD: unknown;
  }): Promise<string | number | boolean> {
    return this.captureAsync(async () => {
      const status = await this.transport().getStatus();
      const field = Scratch.Cast.toString(args.FIELD);
      const value = status[field];
      return isScratchValue(value)
        ? value
        : value === undefined
          ? ""
          : JSON.stringify(value);
    }, "");
  }

  public async getHistory(args: {
    PAGE: unknown;
    LENGTH: unknown;
  }): Promise<string> {
    return this.captureAsync(async () => {
      const page = boundedInteger(
        Scratch.Cast.toNumber(args.PAGE),
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const length = boundedInteger(Scratch.Cast.toNumber(args.LENGTH), 1, 50);
      const transport = this.transport();
      requireCapability(
        transport,
        "history",
        "This connection cannot read paginated history.",
      );
      const getHistory = transport.getHistory?.bind(transport);
      if (getHistory === undefined) {
        throw new Error("This connection cannot read paginated history.");
      }
      return JSON.stringify(await getHistory(page, length));
    }, "[]");
  }

  public async sendCommand(args: {
    COMMAND: unknown;
    HISTORY: unknown;
  }): Promise<void> {
    await this.captureAsync(async () => {
      if (!featureFlags.sesameCommands) {
        throw new Error("Remote lock commands are disabled in this build.");
      }
      const command = Scratch.Cast.toString(args.COMMAND);
      if (!isSesameCommand(command))
        throw new TypeError(`Unknown Sesame command: ${command}`);
      await this.transport().sendCommand(
        command,
        Scratch.Cast.toString(args.HISTORY),
      );
    }, undefined);
  }

  public lastError(): string {
    return this.lastErrorMessage;
  }

  private transport(): SesameTransport {
    if (this.connection?.mode === "direct") {
      return new SesameClient(this.connection.credentials);
    }
    if (
      this.connection?.mode === "relay" &&
      this.connection.session !== undefined
    ) {
      return new RelayClient(this.connection.session);
    }
    if (this.connection?.mode === "relay") {
      throw new Error("Pair with the local relay first.");
    }
    if (this.connection?.mode === "bluetooth") {
      const transport = this.connection.transport;
      if (transport === undefined || !transport.isLoggedIn()) {
        throw new Error("Connect to the Sesame over Bluetooth first.");
      }
      return transport;
    }
    throw new Error(
      "Configure Direct mode, the local relay, or Bluetooth first.",
    );
  }

  private requireBluetooth(): Extract<
    NonNullable<typeof this.connection>,
    { mode: "bluetooth" }
  > {
    if (this.connection?.mode !== "bluetooth") {
      throw new Error("Configure Bluetooth mode first.");
    }
    return this.connection;
  }

  private keyholder(connection: {
    keyholderUrl: string;
    keyholder?: RemoteKeyholder;
  }): RemoteKeyholder {
    connection.keyholder ??= new RemoteKeyholder({
      url: connection.keyholderUrl,
    });
    return connection.keyholder;
  }

  private async releaseBluetooth(): Promise<void> {
    if (this.connection?.mode !== "bluetooth") return;
    const { transport, keyholder } = this.connection;
    await transport?.close().catch(() => undefined);
    keyholder?.dispose();
  }

  private capture(action: () => void): void {
    try {
      action();
      this.lastErrorMessage = "";
    } catch (error) {
      this.lastErrorMessage = normalizeError(error);
    }
  }

  private async captureAsync<T>(
    action: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      const result = await action();
      this.lastErrorMessage = "";
      return result;
    } catch (error) {
      this.lastErrorMessage = normalizeError(error);
      return fallback;
    }
  }

  private toScratchBlock(block: BlockDefinition): Record<string, unknown> {
    return {
      opcode: block.opcode,
      blockType: Scratch.BlockType[block.blockType],
      text: Scratch.translate(block.text),
      arguments: Object.fromEntries(
        Object.entries(block.arguments ?? {}).map(([name, argument]) => [
          name,
          {
            type: Scratch.ArgumentType[argument.type],
            defaultValue: argument.defaultValue,
            ...(argument.menu === undefined ? {} : { menu: argument.menu }),
          },
        ]),
      ),
    };
  }
}

function requireUnsandboxedBluetooth(): void {
  if (!Scratch.extensions.unsandboxed) {
    throw new Error(
      'Bluetooth mode requires reloading this custom extension with "Run extension without sandbox" enabled.',
    );
  }
  if (!isWebBluetoothAvailable()) {
    throw new Error(
      "This browser has no Web Bluetooth. Chrome or Edge on desktop or Android is required; use Relay mode otherwise.",
    );
  }
}

function requireUnsandboxedRelay(): void {
  if (!Scratch.extensions.unsandboxed) {
    throw new Error(
      'Relay mode requires reloading this custom extension with "Run extension without sandbox" enabled so the browser can access localhost.',
    );
  }
}

function isSesameCommand(value: string): value is SesameCommand {
  return value === "lock" || value === "unlock" || value === "toggle";
}

function isScratchValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
