import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
// Both build outputs are committed release artifacts: the extension bundle
// people load into TurboWarp, and the keyholder script GitHub Pages serves.
// index.html beside the keyholder script is written by hand, so it is not
// listed here.
const generated = [
  "dist",
  "docs/keyholder/keyholder.js",
  "docs/keyholder/sw.js",
  "app/extensions",
];
const { stdout } = await execFileAsync(
  "git",
  ["status", "--short", "--untracked-files=all", "--", ...generated],
  { cwd: repositoryRoot },
);

if (stdout.length > 0) {
  process.stderr.write("Generated files are not up to date:\n");
  process.stderr.write(stdout);
  process.exitCode = 1;
}
