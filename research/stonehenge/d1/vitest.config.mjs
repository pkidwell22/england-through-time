import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { "@data": root + "data", "@": root + "src" } },
  test: { include: ["research/stonehenge/d1/*.check.ts"], environment: "node" },
});
