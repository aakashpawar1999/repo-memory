import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "repo-memory-config-"));
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig(tempDir());

    expect(config.maxTokens).toBe(32000);
    expect(config.includeLineNumbers).toBe(true);
    expect(config.ignore).toContain("node_modules");
  });

  it("merges user values over defaults and appends ignore patterns", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, ".repo-memory.json"),
      JSON.stringify({ maxTokens: 8000, ignore: ["generated/"] }),
    );

    const config = loadConfig(dir);

    expect(config.maxTokens).toBe(8000);
    // User patterns extend the defaults, they do not replace them.
    expect(config.ignore).toContain("generated/");
    expect(config.ignore).toContain("node_modules");
    // Untouched keys keep their defaults.
    expect(config.maxTreeDepth).toBe(4);
  });

  it("falls back to defaults when the config file is malformed", () => {
    const dir = tempDir();
    writeFileSync(join(dir, ".repo-memory.json"), "{ not json");

    expect(loadConfig(dir).maxTokens).toBe(32000);
  });
});
