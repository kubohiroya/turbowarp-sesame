import { featureFlags } from "../config/feature-flags.js";
import definitions from "./block-definitions.json";
import { extensionConfig } from "./config.js";
import {
  SesameClient,
  type SesameCommand,
  type SesameCredentials,
} from "./sesame-client.js";

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
  private credentials: SesameCredentials | undefined;
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
      this.credentials = credentials;
    });
  }

  public clearCredentials(): void {
    this.credentials = undefined;
    this.lastErrorMessage = "";
  }

  public isConfigured(): boolean {
    return this.credentials !== undefined;
  }

  public commandsEnabled(): boolean {
    return featureFlags.sesameCommands;
  }

  public async getStatusField(args: {
    FIELD: unknown;
  }): Promise<string | number | boolean> {
    return this.captureAsync(async () => {
      const status = await this.client().getStatus();
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
      return JSON.stringify(await this.client().getHistory(page, length));
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
      await this.client().sendCommand(
        command,
        Scratch.Cast.toString(args.HISTORY),
      );
    }, undefined);
  }

  public lastError(): string {
    return this.lastErrorMessage;
  }

  private client(): SesameClient {
    if (this.credentials === undefined)
      throw new Error("Configure Sesame credentials first.");
    return new SesameClient(this.credentials);
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
