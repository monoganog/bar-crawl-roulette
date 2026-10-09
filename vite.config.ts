import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The version line in the header: package.json's version, how many commits
// in (goes up with every deploy) and the commit it was built from.
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_NUMBER__: JSON.stringify(git("rev-list --count HEAD")),
    __COMMIT__: JSON.stringify(git("rev-parse --short HEAD")),
  },
  // MapLibre is one big chunk, loaded only when the first turn starts.
  build: { chunkSizeWarningLimit: 1200 },
});
