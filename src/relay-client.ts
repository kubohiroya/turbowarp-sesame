import type { FetchLike, SesameCommand } from "./sesame-client.js";
import type { SesameTransport, TransportCapability } from "./transport.js";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/iu;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/u;

export interface RelayConfiguration {
  endpoint: string;
  deviceAlias: string;
}

export interface RelaySession extends RelayConfiguration {
  token: string;
  expiresAt: number;
}

export async function pairWithRelay(
  configuration: RelayConfiguration,
  code: string,
  fetcher: FetchLike = fetch,
): Promise<RelaySession> {
  const normalized = validateRelayConfiguration(configuration);
  if (!/^\d{8}$/u.test(code)) {
    throw new TypeError(
      "Relay pairing code must contain exactly eight digits.",
    );
  }
  const result = await requestJson(fetcher, `${normalized.endpoint}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
    redirect: "error",
  });
  const record = requireRecord(
    result,
    "Relay returned an invalid pairing response.",
  );
  if (!TOKEN_PATTERN.test(String(record.token ?? ""))) {
    throw new Error("Relay returned an invalid pairing token.");
  }
  if (
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt) ||
    record.expiresAt <= Date.now()
  ) {
    throw new Error("Relay returned an invalid session expiration.");
  }
  return {
    ...normalized,
    token: String(record.token),
    expiresAt: record.expiresAt,
  };
}

const BROKER_CAPABILITIES: ReadonlySet<TransportCapability> = new Set([
  "history",
]);

export class RelayClient implements SesameTransport {
  private readonly session: RelaySession;

  public constructor(
    session: RelaySession,
    private readonly fetcher: FetchLike = fetch,
  ) {
    const configuration = validateRelayConfiguration(session);
    if (!TOKEN_PATTERN.test(session.token)) {
      throw new TypeError("Relay token has an invalid format.");
    }
    if (!Number.isFinite(session.expiresAt)) {
      throw new TypeError("Relay session expiration must be a number.");
    }
    this.session = {
      ...configuration,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  public capabilities(): ReadonlySet<TransportCapability> {
    return BROKER_CAPABILITIES;
  }

  public async getStatus(): Promise<Record<string, unknown>> {
    const result = await this.request(this.devicePath("status"));
    return requireRecord(result, "Relay returned an invalid status response.");
  }

  public async getHistory(page: number, length: number): Promise<unknown[]> {
    const parameters = new URLSearchParams({
      page: String(page),
      length: String(length),
    });
    const result = await this.request(
      `${this.devicePath("history")}?${parameters}`,
    );
    if (!Array.isArray(result)) {
      throw new Error("Relay returned an invalid history response.");
    }
    return result;
  }

  public async sendCommand(
    command: SesameCommand,
    history: string,
  ): Promise<unknown> {
    return this.request(this.devicePath(`commands/${command}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ history }),
    });
  }

  private devicePath(suffix: string): string {
    return `/v1/candyhouse/devices/${encodeURIComponent(this.session.deviceAlias)}/${suffix}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    if (this.session.expiresAt <= Date.now()) {
      throw new Error(
        "Relay session has expired. Pair with the local relay again.",
      );
    }
    const result = await requestJson(
      this.fetcher,
      `${this.session.endpoint}${path}`,
      {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${this.session.token}`,
        },
        redirect: "error",
      },
    );
    const record = requireRecord(result, "Relay returned an invalid response.");
    return record.data;
  }
}

export function validateRelayConfiguration(
  configuration: RelayConfiguration,
): RelayConfiguration {
  let url: URL;
  try {
    url = new URL(configuration.endpoint.trim());
  } catch {
    throw new TypeError("Relay endpoint must be a valid URL.");
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new TypeError("Relay endpoint must use HTTP on a loopback hostname.");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new TypeError(
      "Relay endpoint must contain only its loopback origin.",
    );
  }
  const deviceAlias = configuration.deviceAlias.trim();
  if (!ALIAS_PATTERN.test(deviceAlias)) {
    throw new TypeError("Relay device alias has an invalid format.");
  }
  return { endpoint: url.origin, deviceAlias };
}

async function requestJson(
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const response = await fetcher(url, init);
  const text = await response.text();
  let result: unknown = null;
  if (text.length > 0) {
    try {
      result = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Relay returned a non-JSON response (${response.status}).`,
      );
    }
  }
  if (!response.ok) {
    throw new Error(
      `Relay request failed (${response.status}): ${errorDetail(result)}`,
    );
  }
  return result;
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function errorDetail(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const root = value as Record<string, unknown>;
    if (typeof root.error === "object" && root.error !== null) {
      const error = root.error as Record<string, unknown>;
      if (typeof error.message === "string") return error.message;
    }
  }
  return "unknown error";
}
