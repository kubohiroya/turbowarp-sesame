import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

/**
 * The standalone SB3 is the one artifact shipped with lock control enabled, so
 * these tests guard what makes that safe to hand around as a single file.
 */

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url));

const project = async (): Promise<{
  json: Record<string, unknown>;
  extension: string;
}> => {
  const archive = await JSZip.loadAsync(
    await read("dist/turbowarp-sesame-app.sb3"),
  );
  const entry = archive.file("project.json");
  if (entry === null) throw new Error("no project.json");
  const json = JSON.parse(await entry.async("string")) as Record<
    string,
    unknown
  >;
  const urls = json.extensionURLs as Record<string, string>;
  const url = Object.values(urls)[0] ?? "";
  return {
    json,
    extension: Buffer.from(url.split(",", 2)[1] ?? "", "base64").toString(
      "utf8",
    ),
  };
};

describe("the two builds differ in exactly one way", () => {
  it("keeps lock control off in the extension people load by hand", async () => {
    const shipped = (await read("dist/turbowarp-sesame.js")).toString("utf8");
    expect(shipped).toMatch(/sesameCommands:\s*false/u);
    expect(shipped).not.toMatch(/sesameCommands:\s*true/u);
  });

  it("turns lock control on in the standalone app", async () => {
    const { extension } = await project();
    expect(extension).toMatch(/sesameCommands:\s*true/u);
  });

  it("keeps the extension ID and opcodes identical, so projects stay portable", async () => {
    const shipped = (await read("dist/turbowarp-sesame.js")).toString("utf8");
    const { extension } = await project();
    const opcodes = (source: string) =>
      [...source.matchAll(/"opcode":"([a-zA-Z]+)"/gu)].map((match) => match[1]);
    expect(opcodes(extension)).toEqual(opcodes(shipped));
    expect(extension).toContain("kubohiroyasesame");
  });
});

describe("the standalone SB3", () => {
  it("carries the extension inside the file rather than fetching it", async () => {
    const { json } = await project();
    const urls = Object.values(json.extensionURLs as Record<string, string>);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^data:application\/javascript;base64,/u);
  });

  it("uses only Bluetooth blocks, never the credential-carrying ones", async () => {
    const { json } = await project();
    const targets = json.targets as Array<{
      blocks: Record<string, { opcode: string }>;
    }>;
    const used = new Set(
      targets.flatMap((target) =>
        Object.values(target.blocks).map((block) => block.opcode),
      ),
    );
    // `configure` takes an API key and a secret; Relay pairing takes a token.
    expect(used.has("kubohiroyasesame_configure")).toBe(false);
    expect(used.has("kubohiroyasesame_pairRelay")).toBe(false);
    expect(used.has("kubohiroyasesame_configureBluetooth")).toBe(true);
  });

  it("contains no credential of any kind", async () => {
    const { json, extension } = await project();
    const targets = json.targets as Array<{
      costumes: Array<{ assetId: string; md5ext?: string }>;
      sounds: Array<{ assetId: string; md5ext?: string }>;
    }>;
    const assetIds = new Set<string>(
      targets.flatMap((target) =>
        [...target.costumes, ...target.sounds].flatMap((asset) =>
          [asset.assetId, asset.md5ext].filter(
            (value): value is string => typeof value === "string",
          ),
        ),
      ),
    );
    let text = JSON.stringify(json);
    for (const assetId of assetIds) text = text.split(assetId).join("<asset>");

    expect(text).not.toMatch(/ssm:\/\/UI\?t=sk/u);
    expect(extension).not.toMatch(/ssm:\/\/UI\?t=sk/u);
    // Any 32-character hexadecimal literal that is not the all-zero
    // placeholder would be a device secret.
    for (const found of text.matchAll(/\b[0-9a-f]{32}\b/gu)) {
      expect(found[0]).toMatch(/^0+$/u);
    }
  });

  it("points at a keyholder on a different origin, over HTTPS", async () => {
    const { json } = await project();
    const targets = json.targets as Array<{
      blocks: Record<
        string,
        { opcode: string; inputs: Record<string, unknown> }
      >;
    }>;
    const configure = Object.values(targets[0]?.blocks ?? {}).find(
      (block) => block.opcode === "kubohiroyasesame_configureBluetooth",
    );
    const input = configure?.inputs.KEYHOLDER_URL as [number, [number, string]];
    const url = new URL(input[1][1]);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).not.toBe("turbowarp.org");
  });
});
