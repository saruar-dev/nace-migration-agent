import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TICKET } from "./fixtures/findings.js";

const ENTRIES: Array<[string, string[]]> = [["source", ["node_modules/tsx/dist/cli.mjs", "src/index.ts"]]];
if (existsSync("dist/index.js")) ENTRIES.push(["bundle", ["dist/index.js"]]);

const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;

describe.each(ENTRIES)("MCP server (%s)", (_name, args) => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "test", version: "0.0.0" });
    const env = { ...(process.env as Record<string, string>), NACE_NDI_PRICES: "" };
    await client.connect(new StdioClientTransport({ command: process.execPath, args, env }));
  });
  afterAll(async () => {
    await client.close();
  });

  it("lists the four tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "generate_migration_plan",
      "get_ai_detection_patterns",
      "get_integration_template",
      "save_migration_report",
    ]);
  });

  it("returns document patterns and file-input patterns", async () => {
    const r = JSON.parse(text(await client.callTool({ name: "get_ai_detection_patterns", arguments: {} })));
    expect(r.patterns.some((p: { provider: string }) => p.provider === "pdf_text")).toBe(true);
    expect(r.llm_file_input_patterns).toContain("application/pdf");
  });

  it("accepts a short type name", async () => {
    const r = JSON.parse(
      text(await client.callTool({ name: "get_integration_template", arguments: { opportunity_type: "extract", provider: "openai", language: "python" } })),
    );
    expect(r.found).toBe(true);
    expect(r.opportunity_type).toBe("ndi_extract");
  });

  it("builds and saves a report", async () => {
    const plan = text(
      await client.callTool({ name: "generate_migration_plan", arguments: { project_name: "demo", files_scanned: 3, findings: [TICKET] } }),
    );
    expect(plan).toContain("# nace Migration Plan — demo");
    expect(plan).toContain("| Sites that can move to Drex | 1 |");
    const dir = mkdtempSync(join(tmpdir(), "nace-report-"));
    const saved = JSON.parse(text(await client.callTool({ name: "save_migration_report", arguments: { markdown: plan, project_root: dir } })));
    expect(saved.path).toBe(join(dir, "nace-report.md"));
    expect(readFileSync(saved.path, "utf8")).toBe(plan);
  });

  it("rejects a relative project_root", async () => {
    const r = await client.callTool({ name: "save_migration_report", arguments: { markdown: "x", project_root: "relative/dir" } });
    expect(r.isError).toBe(true);
  });
});
