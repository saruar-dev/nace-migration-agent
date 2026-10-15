import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NACE_TYPES } from "../src/tools/types.js";

const read = (p: string) => readFileSync(p, "utf8");
const TOOLS = [...read("src/index.ts").matchAll(/server\.tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("plugin", () => {
  it("names the plugin, marketplace and MCP server", () => {
    const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
    const market = JSON.parse(read(".claude-plugin/marketplace.json"));
    const mcp = JSON.parse(read(".mcp.json"));
    expect(plugin.name).toBe("nace-migrate");
    expect(market.name).toBe("nace");
    expect(market.plugins[0].name).toBe("nace-migrate");
    expect(market.plugins[0].skills).toEqual(["./skills/evaluate"]);
    expect(Object.keys(mcp.mcpServers)).toEqual(["nace-migration-agent"]);
    expect(mcp.mcpServers["nace-migration-agent"].args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/index.js"]);
  });

  it("keeps the two skill copies identical", () => {
    expect(read(".agents/skills/evaluate/SKILL.md")).toBe(read("skills/evaluate/SKILL.md"));
  });

  it("lets the skill call every server tool under both names", () => {
    const skill = read("skills/evaluate/SKILL.md");
    expect(TOOLS).toHaveLength(4);
    for (const tool of TOOLS) {
      expect(skill).toContain(`mcp__plugin_nace-migrate_nace-migration-agent__${tool}`);
      expect(skill).toContain(`mcp__nace-migration-agent__${tool}`);
    }
  });

  it("teaches every nace type", () => {
    const skill = read("skills/evaluate/SKILL.md");
    for (const t of NACE_TYPES) expect(skill).toContain(t);
  });

  it("has no ScaleDown leftovers outside the credits", () => {
    const shipped = [...files("src"), ...files("skills"), ...files(".agents"), ...files(".claude-plugin"), ".mcp.json"];
    for (const f of shipped) expect(read(f).toLowerCase(), f).not.toContain("scaledown");
  });
});
