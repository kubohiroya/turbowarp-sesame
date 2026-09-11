import { featureFlags } from "../config/feature-flags.js";
import definitions from "./block-definitions.json";
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
import type { SesameTransport } from "./transport.js";

type BlockTypeName = "COMMAND" | "REPORTER" | "BOOLEAN";
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
    | undefined;
  private lastErrorMessage = "";

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

  public clearCredentials(): void {
    this.connection = undefined;
    this.lastErrorMessage = "";
  }

  public isConfigured(): boolean {
    return this.connection?.mode === "direct" || this.relayPaired();
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
      return JSON.stringify(await this.transport().getHistory(page, length));
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
    throw new Error("Configure Direct mode or the local relay first.");
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
