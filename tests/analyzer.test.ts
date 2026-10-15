import { describe, expect, it } from "vitest";
import { generateMigrationPlanMarkdown } from "../src/tools/analyzer.js";
import { INVOICE, REPLY, SENTIMENT, TICKET } from "./fixtures/findings.js";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const report = (ndiPrices: Partial<Record<"parse" | "split" | "classify" | "extract" | "ground", number>> = {}) =>
  generateMigrationPlanMarkdown([TICKET, SENTIMENT, INVOICE, REPLY], {
    projectName: "demo",
    filesScanned: 12,
    ndiPrices,
    now: NOW,
  });

describe("generateMigrationPlanMarkdown", () => {
  it("writes the header and summary", () => {
    const md = report();
    expect(md).toContain("# nace Migration Plan — demo");
    expect(md).toContain("> Generated: 2026-10-15T12:00:00.000Z");
    expect(md).toContain("| Files scanned | 12 |");
    expect(md).toContain("| Files with AI or document calls | 4 |");
    expect(md).toContain("| Sites that can move to Drex | 2 |");
    expect(md).toContain("| Sites that can move to NDI | 1 |");
    expect(md).toContain("| Calls that stay on the LLM | 1 |");
    expect(md).toContain("| Estimated cost of 1,000 runs of each estimated site, today | $15.25 |");
    expect(md).toContain("| Same, with nace | $0.09 + 6,000 extract credits |");
    expect(md).toContain("| Sites without a full estimate | 1 |");
  });

  it("orders the sections", () => {
    const md = report();
    const order = ["## Summary", "## Drex sites", "## NDI sites", "## Stays on the LLM", "## Split-up calls", "## nace API reference", "## Setup"];
    const positions = order.map((h) => md.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("writes a Drex site with its cost line", () => {
    const md = report();
    expect(md).toContain("### Drex choice: one label from a fixed set");
    expect(md).toContain(
      "- **Ticket category** (`src/services/classifier.py:280`): high confidence, simple (2/5). Picks one of 8 fixed categories and the router branches on it.",
    );
    expect(md).toContain("  - Cost per call: $0.00375 today → $0.000018 with nace; per 1,000 calls $3.75 → $0.018");
    expect(md).toContain("  - Assumptions: ticket body ≈ 150 tokens");
  });

  it("says when the old model has no price", () => {
    const md = report();
    expect(md).toContain("  - Cost per call: not estimated today → $0.000012 with nace; per 1,000 calls not estimated → $0.012");
    expect(md).toContain("  - Notes: llama-3.3-70b-versatile: not on the price list, not estimated");
  });

  it("lists a mixed finding once, under its first product, with an Also line", () => {
    const md = report();
    expect(md).toContain("### NDI extract: fields from a file, with citations");
    expect(md.match(/\*\*Invoice fields\*\*/g)).toHaveLength(1);
    expect(md).toContain("  - Also: drex_noul (medium): The same prompt also flags printed PII.");
    expect(md).toContain("  - Cost per call: $0.0115 today → $0.000072 + 6 extract credits with nace; per 1,000 calls $11.50 → $0.072 + 6,000 extract credits");
  });

  it("prices NDI from per-tool prices", () => {
    const md = report({ extract: 30 });
    expect(md).toContain("  - Cost per call: $0.0115 today → $0.0601 with nace; per 1,000 calls $11.50 → $60.07");
    expect(md).toContain("Priced per 1,000 pages: extract $30.00.");
  });

  it("lists calls that stay on the LLM and split-up calls", () => {
    const md = report();
    expect(md).toContain("- **Suggested reply** (`src/services/rag.py:427`): Generates a free-text reply for the agent.");
    expect(md).toContain("### Invoice fields (`src/extract.ts:42`)");
    expect(md).toContain("| 1 | Pull invoice fields | NDI `ndi_extract` | Schema from the zod type |");
    expect(md).toContain("| 2 | Flag printed PII | Drex `drex_noul` | One noul on the parsed text |");
  });

  it("documents the nace API, not ScaleDown", () => {
    const md = report();
    expect(md).toContain("https://console.nace.ai");
    expect(md).toContain("Authorization: Bearer $NACE_API_KEY");
    expect(md.toLowerCase()).not.toContain("scaledown");
  });

  it("says not estimated when no site has a full estimate", () => {
    const md = generateMigrationPlanMarkdown([SENTIMENT, REPLY], { projectName: "demo", now: NOW });
    expect(md).toContain("| Estimated cost of 1,000 runs of each estimated site, today | not estimated |");
    expect(md).toContain("| Same, with nace | not estimated |");
    expect(md).toContain("| Sites without a full estimate | 1 |");
  });

  it("handles an empty scan", () => {
    const md = generateMigrationPlanMarkdown([], { projectName: "empty", now: NOW });
    expect(md).toContain("No AI or document-processing calls were found.");
  });
});
