import type { SesameCommand } from "./sesame-client.js";

export interface SesameTransport {
  getStatus(): Promise<Record<string, unknown>>;
  getHistory(page: number, length: number): Promise<unknown[]>;
  sendCommand(command: SesameCommand, history: string): Promise<unknown>;
}
