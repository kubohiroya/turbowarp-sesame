import { describe, expect, it, vi } from "vitest";
import { SesameClient } from "../src/sesame-client.js";

const credentials = {
  apiKey: "test-api-key",
  uuid: "00000000-0000-0000-0000-000000000000",
  secretKey: "00000000000000000000000000000000",
};

describe("SesameClient", () => {
  it("requests bounded history parameters supplied by the extension", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response("[]", { status: 200 });
      },
    );
    const client = new SesameClient(credentials, fetcher);

    await expect(client.getHistory(2, 25)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://app.candyhouse.co/api/sesame2/00000000-0000-0000-0000-000000000000/history?page=2&lg=25",
      expect.objectContaining({ headers: { "x-api-key": "test-api-key" } }),
    );
  });

  it("creates a signed command request without exposing the secret", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response('{"statusCode":200}', { status: 200 });
      },
    );
    const client = new SesameClient(
      credentials,
      fetcher,
      () => 0x12345678 * 1000,
    );

    await client.sendCommand("lock", "玄関");

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://app.candyhouse.co/api/sesame2/00000000-0000-0000-0000-000000000000/cmd",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "test-api-key",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      cmd: 82,
      history: "546E6Zai",
      sign: "955374fb09f2cdef084aeec8bfda344b",
    });
    expect(JSON.stringify(body)).not.toContain(credentials.secretKey);
  });
});
