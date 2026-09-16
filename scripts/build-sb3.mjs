/**
 * Builds the standalone SB3 and checks the properties that make it safe to
 * hand around as a single file.
 *
 * The app build is the one place where lock control is enabled, so the
 * assertions below are the guardrails for that decision: the file must carry
 * the commands-enabled extension, and it must carry no credential of any kind.
 * A device secret reaches the lock only through the keyholder, on its own
 * origin, after the person pairs a sharing QR code there.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildSb3 } from "@kubohiroya/sb3-toolchain";
import JSZip from "jszip";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectory = fileURLToPath(new URL("../app/", import.meta.url));
const outputPath = fileURLToPath(
  new URL("../dist/turbowarp-sesame-app.sb3", import.meta.url),
);

// Replacement is allowed because the output is a build artifact under Git:
// drift is caught by check:dist rather than by an interactive prompt.
await buildSb3({ sourceDirectory, outputPath, yes: true });

const archive = await JSZip.loadAsync(await readFile(outputPath));
const projectEntry = archive.file("project.json");
if (projectEntry === null) throw new Error("The SB3 has no project.json.");
const project = JSON.parse(await projectEntry.async("string"));

const failures = [];

// The extension must travel inside the file, not be fetched from anywhere.
const urls = Object.values(project.extensionURLs ?? {});
if (urls.length !== 1) {
  failures.push(`expected one embedded extension, found ${urls.length}`);
}
for (const url of urls) {
  if (!url.startsWith("data:")) {
    failures.push(
      `extension is loaded from ${url.slice(0, 40)}…, not embedded`,
    );
  }
}

const embedded = Buffer.from(urls[0].split(",", 2)[1], "base64").toString(
  "utf8",
);

// Lock control is deliberately on here, and deliberately off in dist/.
if (!/sesameCommands:\s*true/u.test(embedded)) {
  failures.push("the embedded extension does not have lock control enabled");
}
const shipped = await readFile(
  new URL("../dist/turbowarp-sesame.js", import.meta.url),
  "utf8",
);
if (!/sesameCommands:\s*false/u.test(shipped)) {
  failures.push("dist/turbowarp-sesame.js must keep lock control disabled");
}

// Nothing that could authenticate to a lock may be in a file people download.
// The project is scanned strictly, because that is where a block literal would
// put a credential. The extension bundle is scanned only for structured
// credentials: it legitimately carries placeholder defaults for the blocks it
// defines, which are not secrets.
const assetIds = new Set(
  project.targets.flatMap((target) =>
    [...target.costumes, ...target.sounds].flatMap((asset) =>
      [asset.assetId, asset.md5ext].filter(Boolean),
    ),
  ),
);
let projectText = JSON.stringify(project);
for (const assetId of assetIds) {
  projectText = projectText.split(assetId).join("<asset>");
}
// The all-zero value is the placeholder the Direct-mode block ships with.
const PLACEHOLDER = /^0+$/u;

const structured = [
  [/\bssm:\/\/UI\?t=sk\b/u, "a sharing QR code URL"],
  [/secretKey["']?\s*[:=]\s*["'][0-9a-f]{32}/iu, "a device secret"],
  [/apiKey["']?\s*[:=]\s*["'][^"']{8,}/u, "an API key"],
];

for (const [pattern, what] of structured) {
  for (const [text, where] of [
    [projectText, "project"],
    [embedded, "embedded extension"],
  ]) {
    const found = pattern.exec(text);
    if (found !== null) {
      failures.push(`the ${where} contains ${what}: ${found[0].slice(0, 24)}…`);
    }
  }
}

for (const found of projectText.matchAll(/\b[0-9a-f]{32}\b/gu)) {
  if (!PLACEHOLDER.test(found[0])) {
    failures.push(
      `the project contains a 32-character hexadecimal value: ${found[0].slice(0, 12)}…`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(`${outputPath.replace(root, "")} failed its checks:\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

const built = await readFile(outputPath);
await writeFile(
  new URL("../dist/turbowarp-sesame-app.sb3.sha256", import.meta.url),
  `${await sha256(built)}  turbowarp-sesame-app.sb3\n`,
);

// Also published by GitHub Pages, so the download has a plain URL people can
// be given rather than a repository path.
await writeFile(
  new URL("../docs/turbowarp-sesame-app.sb3", import.meta.url),
  built,
);

process.stdout.write(
  `Built dist/turbowarp-sesame-app.sb3 with lock control enabled and no credentials.\n`,
);

async function sha256(data) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}
