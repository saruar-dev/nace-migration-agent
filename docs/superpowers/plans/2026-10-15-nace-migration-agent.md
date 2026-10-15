# nace-migration-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SLM_Agent fork into a Claude Code plugin + MCP server that finds LLM and document-processing calls that can move to nace's Drex and NDI, estimates the cost before and after, writes `nace-report.md`, and migrates approved sites with `nace-sdk`.

**Architecture:** Same shape as SLM_Agent: a local stdio MCP server returns fixed data (search patterns, code templates, prices) and does deterministic work (cost arithmetic, report markdown, file write); the `evaluate` skill tells the user's coding agent how to find, trace and sort calls. The server makes no network calls. The bundled server (`dist/index.js`, one file built by esbuild) is committed so the plugin installs from git.

**Tech Stack:** TypeScript (ESM, Node ≥20), `@modelcontextprotocol/sdk` 1.29 (locked), `zod` 3.25 (locked), vitest 4.1.11, esbuild 0.28.2, `nace-sdk` 0.1.0 (Python and npm, live checks only).

**Spec:** `docs/superpowers/specs/2026-10-15-nace-migration-agent-design.md` (commit `0e645ee`). Read it before starting.

## Global Constraints

- Names: npm package `nace-migration-agent`; plugin `nace-migrate`; MCP server `nace-migration-agent`; marketplace `nace`; command `/nace-migrate:evaluate`; report file `nace-report.md`.
- Opportunity types, exactly: `drex_choice`, `drex_noul`, `drex_score`, `ndi_parse`, `ndi_split`, `ndi_classify`, `ndi_extract`, `ndi_ground`.
- nace API: base URL `https://console.nace.ai`, `Authorization: Bearer $NACE_API_KEY`, one `nace_sk_` key for Drex and NDI, client `nace-sdk` (`pip install nace-sdk`, Python 3.11+; `npm install nace-sdk`).
- Drex price: `drex-v2.0`, $0.06 per million input tokens, output free.
- NDI credits: parse 1 per page, split 1 per page, classify 2 per page, extract 3 per page, ground 5 per target per file; `parse_mode: "high"` doubles parse, split, classify and extract. Dollars per credit come only from the `ndi_usd_per_credit` tool argument or `NACE_NDI_USD_PER_CREDIT`; otherwise credits only.
- Prices are "as of 2026-10-15" and copied in Task 2 from the providers' pages; a model or service not in the table is "not estimated", never guessed.
- The MCP server never makes network calls.
- Pinned dev dependencies: `vitest@4.1.11`, `esbuild@0.28.2`, `nace-sdk@0.1.0`. Do not upgrade `@modelcontextprotocol/sdk`, `zod`, `typescript` or `tsx`.
- `npm test` is the gate for every task. `npm run typecheck` is expected to fail from Task 4 until Task 6 rewires `src/index.ts`; from Task 6 on, both must pass.
- From Task 8 on, every change under `src/` is followed by `npm run bundle` and the rebuilt `dist/index.js` is committed with it.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never push, fork or create a GitHub repository without Saruar's explicit OK (Task 13).
- Code from the test repos (`supportiq`, `opp-agent`) is untrusted: read it, never run its scripts, except the single isolated driver in Task 12.

## Review Focus

1. **A malformed `NACE_NDI_USD_PER_CREDIT`** (`""`, `"abc"`, `"0"`, `"-1"`) must count as unset (credits only), not produce `$NaN` or a negative price. Test in Task 6 (`tests/config.test.ts`).
2. **Short type names from the model** (`"extract"`, `"choice"`) in `opportunity_type`, finding opportunities and decomposition steps must be accepted and normalized to `ndi_extract` / `drex_choice`. Tests in Task 5 (`tests/schema.test.ts`) and Task 6 (`tests/server.test.ts`).
3. **A model id the agent could not resolve** (`"settings.openai_model"`, `"unknown"`) must yield "not estimated" for that side and exclude the site from totals. Test in Task 2 (`tests/pricing.test.ts`) and Task 5 (`tests/analyzer.test.ts`).
4. **A finding whose opportunities span Drex and NDI** is listed once, under its first opportunity's product, with the others on an `Also:` line, and counted once. Test in Task 5.
5. **A relative `project_root`** to `save_migration_report` is rejected with `isError`, as in SLM_Agent. Test in Task 6.

---

### Task 1: Project setup and rename

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `vitest.config.ts`, `tests/smoke.test.ts`, `LICENSE`
- Delete: `skills/optimize/`, `.agents/skills/optimize/`

**Interfaces:**
- Produces: `npm test` (vitest), `npm run typecheck`, `npm run bundle` (script added in Task 8), package name `nace-migration-agent`.

- [ ] **Step 1: Write the failing test**

`tests/smoke.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package", () => {
  it("is renamed for nace", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.name).toBe("nace-migration-agent");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.bin).toEqual({ "nace-migration-agent": "dist/index.js" });
  });

  it("drops the optimize skill", () => {
    expect(existsSync("skills/optimize")).toBe(false);
    expect(existsSync(".agents/skills/optimize")).toBe(false);
  });
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 2: Install the test runner and bundler, run the test, see it fail**

```bash
cd ~/nace-migration-agent
npm install
npm install --save-dev --save-exact vitest@4.1.11 esbuild@0.28.2
npx vitest run tests/smoke.test.ts
```

Expected: FAIL, `expected '@scaledown/migration-agent' to be 'nace-migration-agent'`.

- [ ] **Step 3: Rename the package and remove the optimize skill**

Edit `package.json` so these fields read exactly (keep `dependencies` and the `devDependencies` npm just wrote):

```json
{
  "name": "nace-migration-agent",
  "version": "0.1.0",
  "description": "Find the LLM and document-processing calls in a codebase that can move to nace's Drex (decisions) and NDI (documents), estimate the cost before and after, and migrate them",
  "type": "module",
  "main": "dist/index.js",
  "bin": { "nace-migration-agent": "dist/index.js" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "bundle": "node scripts/bundle.mjs",
    "build": "npm run typecheck && npm run bundle",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "live-check": "tsx scripts/live-check.ts"
  },
  "files": ["dist/", "skills/", ".agents/", ".claude-plugin/", ".mcp.json", "README.md", "LICENSE"],
  "keywords": ["nace", "drex", "ndi", "mcp", "claude-code", "cursor", "migration", "cost-reduction"],
  "license": "MIT"
}
```

```bash
git rm -r -q skills/optimize .agents/skills/optimize
```

Replace `.gitignore` with:

```
node_modules/
*.js.map
.live-check/
.e2e/
```

(`dist/` is no longer ignored: Task 8 commits the bundle.)

Create `LICENSE`:

```
MIT License

Copyright (c) 2025 ScaleDown
Copyright (c) 2026 nace.ai

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Run the tests and the typecheck**

```bash
npm test && npm run typecheck
```

Expected: 2 tests pass; typecheck passes (no `src/` changes yet).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename the fork to nace-migration-agent, add vitest and esbuild, drop optimize

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared types and the price list

**Files:**
- Create: `src/tools/types.ts`, `src/tools/pricing.ts`
- Test: `tests/pricing.test.ts`

**Interfaces:**
- Produces (`src/tools/types.ts`): `NACE_TYPES`, `type NaceType`, `type Product = "drex" | "ndi"`, `type Language = "python" | "typescript"`, `NDI_TOOLS`, `type NdiTool`, `productOf(type: NaceType): Product`, `TYPE_LABELS: Record<NaceType, string>`, `TYPE_ALIASES: Record<string, NaceType>`, `type CostBefore`, `type CostAfterStep`, `type CostBlock`.
- Produces (`src/tools/pricing.ts`): `PRICES_AS_OF`, `lookupLlmPrice(model: string): PriceMatch | null`, `lookupOcrPrice(service: string)`, `DREX_MODEL`, `DREX_USD_PER_M_INPUT`, `NDI_CREDITS_PER_UNIT`, `ndiCredits(step)`, `interface CostEstimate { before_usd: number | null; after_usd: number | null; ndi_credits: number; ndi_priced: boolean; notes: string[] }`, `estimateCost(cost: CostBlock, ndiUsdPerCredit: number | null): CostEstimate`, `formatUsd(n: number): string`.

- [ ] **Step 1: Write the failing tests**

`tests/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateCost, formatUsd, lookupLlmPrice, lookupOcrPrice, ndiCredits } from "../src/tools/pricing.js";
import { productOf } from "../src/tools/types.js";

describe("lookupLlmPrice", () => {
  it("matches exact ids", () => {
    expect(lookupLlmPrice("gpt-4o")).toMatchObject({ input: 2.5, output: 10, matched: "gpt-4o" });
    expect(lookupLlmPrice("gpt-4o-2024-05-13")).toMatchObject({ input: 5, output: 15 });
  });
  it("strips provider prefixes and date suffixes", () => {
    expect(lookupLlmPrice("openai/gpt-4o-mini")).toMatchObject({ input: 0.15, output: 0.6 });
    expect(lookupLlmPrice("models/gemini-2.5-flash")).toMatchObject({ input: 0.3, output: 2.5 });
    expect(lookupLlmPrice("gpt-4o-2024-08-06")).toMatchObject({ input: 2.5, matched: "gpt-4o", note: "priced as gpt-4o" });
  });
  it("prices unlisted GPT-4 Turbo ids as the listed snapshot, with a note", () => {
    const p = lookupLlmPrice("gpt-4-turbo-preview");
    expect(p).toMatchObject({ input: 10, output: 30, matched: "gpt-4-turbo-2024-04-09" });
    expect(p?.note).toContain("not on the pricing page");
  });
  it("normalizes Claude ids to family and version", () => {
    expect(lookupLlmPrice("claude-sonnet-4-5-20250929")).toMatchObject({ input: 3, output: 15, matched: "claude sonnet-4.5" });
    expect(lookupLlmPrice("claude-opus-4-20250514")).toMatchObject({ input: 15, output: 75, matched: "claude opus-4" });
    expect(lookupLlmPrice("claude-3-5-haiku-latest")).toMatchObject({ input: 0.8, output: 4 });
  });
  it("returns null for models that are not on the price list", () => {
    expect(lookupLlmPrice("claude-3-5-sonnet-20241022")).toBeNull();
    expect(lookupLlmPrice("llama-3.3-70b-versatile")).toBeNull();
    expect(lookupLlmPrice("settings.openai_model")).toBeNull();
    expect(lookupLlmPrice("unknown")).toBeNull();
  });
});

describe("lookupOcrPrice", () => {
  it("knows Textract and nothing it could not verify", () => {
    expect(lookupOcrPrice("textract:analyze_expense")?.per_page).toBe(0.01);
    expect(lookupOcrPrice("azure:prebuilt-invoice")).toBeNull();
  });
});

describe("ndiCredits", () => {
  it("multiplies credits per page", () => {
    expect(ndiCredits({ handler: "ndi", tool: "extract", pages: 2 })).toBe(6);
    expect(ndiCredits({ handler: "ndi", tool: "extract", pages: 2, parse_mode: "high" })).toBe(12);
    expect(ndiCredits({ handler: "ndi", tool: "parse", pages: 3, parse_mode: "medium" })).toBe(3);
  });
  it("prices ground per target", () => {
    expect(ndiCredits({ handler: "ndi", tool: "ground", pages: 10, targets: 3 })).toBe(15);
    expect(ndiCredits({ handler: "ndi", tool: "ground", pages: 10 })).toBe(5);
  });
});

describe("estimateCost", () => {
  it("compares an LLM call with Drex", () => {
    const e = estimateCost(
      { before: { kind: "llm", model: "gpt-4o", input_tokens: 1000, output_tokens: 200 }, after: [{ handler: "drex", input_tokens: 600 }], assumptions: [] },
      null,
    );
    expect(e.before_usd).toBeCloseTo(0.0045, 10);
    expect(e.after_usd).toBeCloseTo(0.000036, 10);
    expect(e.ndi_priced).toBe(true);
  });
  it("keeps NDI in credits when no price per credit is given", () => {
    const e = estimateCost(
      { before: { kind: "local", library: "pdf-parse" }, after: [{ handler: "ndi", tool: "parse", pages: 2 }], assumptions: [] },
      null,
    );
    expect(e).toMatchObject({ before_usd: 0, after_usd: 0, ndi_credits: 2, ndi_priced: false });
    expect(e.notes.join(" ")).toContain("NACE_NDI_USD_PER_CREDIT");
  });
  it("prices NDI when a price per credit is given", () => {
    const e = estimateCost(
      { before: { kind: "ocr_service", service: "textract:analyze_expense", pages: 2 }, after: [{ handler: "ndi", tool: "extract", pages: 2 }], assumptions: [] },
      0.01,
    );
    expect(e.before_usd).toBeCloseTo(0.02, 10);
    expect(e.after_usd).toBeCloseTo(0.06, 10);
    expect(e.ndi_priced).toBe(true);
  });
  it("marks unknown models and services as not estimated", () => {
    const e = estimateCost(
      { before: { kind: "ocr_service", service: "azure:prebuilt-invoice", pages: 1 }, after: [{ handler: "llm", model: "settings.openai_model", input_tokens: 10, output_tokens: 10 }], assumptions: [] },
      null,
    );
    expect(e.before_usd).toBeNull();
    expect(e.after_usd).toBeNull();
    expect(e.notes).toEqual([
      "azure:prebuilt-invoice: no published per-page price, not estimated",
      "settings.openai_model: not on the price list, not estimated",
    ]);
  });
});

describe("formatUsd", () => {
  it("formats small and large amounts", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(3.7500000000000004)).toBe("$3.75");
    expect(formatUsd(11.5)).toBe("$11.50");
    expect(formatUsd(0.0115)).toBe("$0.0115");
    expect(formatUsd(0.000018)).toBe("$0.000018");
    expect(formatUsd(0.018000000000000002)).toBe("$0.018");
    expect(formatUsd(0.0000001)).toBe("<$0.000001");
  });
});

describe("productOf", () => {
  it("splits types by product", () => {
    expect(productOf("drex_score")).toBe("drex");
    expect(productOf("ndi_ground")).toBe("ndi");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/pricing.test.ts`
Expected: FAIL, cannot resolve `../src/tools/pricing.js`.

- [ ] **Step 3: Write `src/tools/types.ts`**

```ts
export const NACE_TYPES = [
  "drex_choice",
  "drex_noul",
  "drex_score",
  "ndi_parse",
  "ndi_split",
  "ndi_classify",
  "ndi_extract",
  "ndi_ground",
] as const;
export type NaceType = (typeof NACE_TYPES)[number];

export type Product = "drex" | "ndi";
export type Language = "python" | "typescript";

export const NDI_TOOLS = ["parse", "split", "classify", "extract", "ground"] as const;
export type NdiTool = (typeof NDI_TOOLS)[number];

export function productOf(type: NaceType): Product {
  return type.startsWith("drex_") ? "drex" : "ndi";
}

export const TYPE_LABELS: Record<NaceType, string> = {
  drex_choice: "Drex choice: one label from a fixed set",
  drex_noul: "Drex noul: yes/no probability",
  drex_score: "Drex score: a level on an ordered rubric",
  ndi_parse: "NDI parse: file to text",
  ndi_split: "NDI split: packet to separate documents",
  ndi_classify: "NDI classify: document or page type",
  ndi_extract: "NDI extract: fields from a file, with citations",
  ndi_ground: "NDI ground: where a value appears in a file",
};

/** Short names models tend to write, mapped to the full type. */
export const TYPE_ALIASES: Record<string, NaceType> = {
  choice: "drex_choice",
  noul: "drex_noul",
  score: "drex_score",
  parse: "ndi_parse",
  split: "ndi_split",
  classify: "ndi_classify",
  extract: "ndi_extract",
  ground: "ndi_ground",
};

export type CostBefore =
  | { kind: "llm"; model: string; input_tokens: number; output_tokens: number }
  | { kind: "ocr_service"; service: string; pages: number }
  | { kind: "local"; library: string };

export type CostAfterStep =
  | { handler: "drex"; input_tokens: number }
  | { handler: "ndi"; tool: NdiTool; pages: number; targets?: number; parse_mode?: "low" | "medium" | "high" }
  | { handler: "llm"; model: string; input_tokens: number; output_tokens: number };

export interface CostBlock {
  before: CostBefore;
  after: CostAfterStep[];
  assumptions: string[];
}
```

- [ ] **Step 4: Write `src/tools/pricing.ts`**

Prices below were read from the providers' pages on 2026-10-15 (OpenAI `https://developers.openai.com/api/docs/pricing`, Anthropic `https://platform.claude.com/docs/en/about-claude/pricing`, Google `https://ai.google.dev/gemini-api/docs/pricing`, AWS `https://aws.amazon.com/textract/pricing/`). Azure Document Intelligence publishes no static prices and the Google Document AI figures could not be confirmed, so neither is listed.

```ts
import type { CostAfterStep, CostBlock, NdiTool } from "./types.js";

export const PRICES_AS_OF = "2026-10-15";

/** USD per million tokens. */
export interface TokenPrice {
  input: number;
  output: number;
  source: string;
}

export interface PriceMatch extends TokenPrice {
  matched: string;
  note?: string;
}

const OPENAI = "https://developers.openai.com/api/docs/pricing";
const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing";
const GOOGLE = "https://ai.google.dev/gemini-api/docs/pricing";
const TEXTRACT = "https://aws.amazon.com/textract/pricing/";

const p = (input: number, output: number, source: string): TokenPrice => ({ input, output, source });

/** Exact model ids as listed on the pricing pages on PRICES_AS_OF. Tiered prices use the lowest tier. */
export const LLM_PRICES: Record<string, TokenPrice> = {
  "gpt-6-astra": p(10, 50, OPENAI),
  "gpt-6.1-sol": p(2, 10, OPENAI),
  "gpt-6-sol": p(2, 10, OPENAI),
  "gpt-6-luna": p(0.1, 0.5, OPENAI),
  "gpt-5.6-sol": p(4, 20, OPENAI),
  "gpt-5.6-terra": p(2, 12, OPENAI),
  "gpt-5.6-luna": p(0.2, 1.2, OPENAI),
  "gpt-5.5": p(5, 30, OPENAI),
  "gpt-5.5-pro": p(30, 180, OPENAI),
  "gpt-5.4": p(2.5, 15, OPENAI),
  "gpt-5.4-mini": p(0.75, 4.5, OPENAI),
  "gpt-5.4-nano": p(0.2, 1.25, OPENAI),
  "gpt-5.4-pro": p(30, 180, OPENAI),
  "gpt-5.2": p(1.75, 14, OPENAI),
  "gpt-5.2-pro": p(21, 168, OPENAI),
  "gpt-5.1": p(1.25, 10, OPENAI),
  "gpt-5": p(1.25, 10, OPENAI),
  "gpt-5-mini": p(0.25, 2, OPENAI),
  "gpt-5-nano": p(0.05, 0.4, OPENAI),
  "gpt-5-pro": p(15, 120, OPENAI),
  "chat-latest": p(5, 30, OPENAI),
  "gpt-4.1": p(2, 8, OPENAI),
  "gpt-4.1-mini": p(0.4, 1.6, OPENAI),
  "gpt-4.1-nano": p(0.1, 0.4, OPENAI),
  "gpt-4o": p(2.5, 10, OPENAI),
  "gpt-4o-2024-05-13": p(5, 15, OPENAI),
  "gpt-4o-mini": p(0.15, 0.6, OPENAI),
  o1: p(15, 60, OPENAI),
  "o1-pro": p(150, 600, OPENAI),
  o3: p(2, 8, OPENAI),
  "o3-pro": p(20, 80, OPENAI),
  "o3-mini": p(1.1, 4.4, OPENAI),
  "o4-mini": p(1.1, 4.4, OPENAI),
  "gpt-4-turbo-2024-04-09": p(10, 30, OPENAI),
  "gpt-4-0613": p(30, 60, OPENAI),
  "gpt-3.5-turbo": p(0.5, 1.5, OPENAI),
  "gpt-3.5-turbo-0125": p(0.5, 1.5, OPENAI),
  "gpt-3.5-turbo-1106": p(1, 2, OPENAI),
  "gemini-4-argon": p(2, 10, GOOGLE),
  "gemini-3.8-flash": p(0.75, 3.75, GOOGLE),
  "gemini-3.6-flash": p(0.75, 3.75, GOOGLE),
  "gemini-3.5-flash-lite": p(0.3, 2.5, GOOGLE),
  "gemini-3.1-flash-lite": p(0.25, 1.5, GOOGLE),
  "gemini-3.1-pro-preview": p(2, 12, GOOGLE),
  "gemini-3-flash-preview": p(0.5, 3, GOOGLE),
  "gemini-2.5-pro": p(1.25, 10, GOOGLE),
  "gemini-2.5-flash": p(0.3, 2.5, GOOGLE),
  "gemini-2.5-flash-lite": p(0.1, 0.4, GOOGLE),
};

/** Claude prices keyed by family and version, so any dated or aliased id resolves (see claudeKey). */
export const CLAUDE_PRICES: Record<string, TokenPrice> = {
  "fable-5.1": p(10, 50, ANTHROPIC),
  "fable-5": p(10, 50, ANTHROPIC),
  "mythos-5.1": p(10, 50, ANTHROPIC),
  "mythos-5": p(10, 50, ANTHROPIC),
  "opus-5.5": p(4, 20, ANTHROPIC),
  "opus-5": p(5, 25, ANTHROPIC),
  "opus-4.8": p(5, 25, ANTHROPIC),
  "opus-4.7": p(5, 25, ANTHROPIC),
  "opus-4.6": p(5, 25, ANTHROPIC),
  "opus-4.5": p(5, 25, ANTHROPIC),
  "opus-4.1": p(15, 75, ANTHROPIC),
  "opus-4": p(15, 75, ANTHROPIC),
  "sonnet-5.5": p(2, 10, ANTHROPIC),
  "sonnet-5": p(2, 10, ANTHROPIC),
  "sonnet-4.6": p(3, 15, ANTHROPIC),
  "sonnet-4.5": p(3, 15, ANTHROPIC),
  "sonnet-4": p(3, 15, ANTHROPIC),
  "haiku-5.5": p(0.1, 0.5, ANTHROPIC),
  "haiku-4.5": p(1, 5, ANTHROPIC),
  "haiku-3.5": p(0.8, 4, ANTHROPIC),
};

const GPT4_TURBO = {
  to: "gpt-4-turbo-2024-04-09",
  note: "not on the pricing page; priced as gpt-4-turbo-2024-04-09, the listed GPT-4 Turbo snapshot",
};

/** Ids that are not on the pricing pages but belong to a listed model. */
const ALIASES: Record<string, { to: string; note: string }> = {
  "gpt-4-turbo": GPT4_TURBO,
  "gpt-4-turbo-preview": GPT4_TURBO,
  "gpt-4-0125-preview": GPT4_TURBO,
  "gpt-4-1106-preview": GPT4_TURBO,
  "gpt-4-vision-preview": GPT4_TURBO,
  "gpt-4": { to: "gpt-4-0613", note: "not on the pricing page; priced as gpt-4-0613, the listed GPT-4 snapshot" },
  "chatgpt-4o-latest": { to: "gpt-4o", note: "priced as gpt-4o" },
};

function claudeKey(id: string): string | null {
  const current = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:[-.](\d))?(?:-\d{8}|-latest)?$/.exec(id);
  if (current) return `${current[1]}-${current[2]}${current[3] !== undefined ? `.${current[3]}` : ""}`;
  const legacy = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)(?:-\d{8}|-latest)?$/.exec(id);
  if (legacy) return `${legacy[3]}-${legacy[1]}${legacy[2] !== undefined ? `.${legacy[2]}` : ""}`;
  return null;
}

export function lookupLlmPrice(model: string): PriceMatch | null {
  const id = model.trim().toLowerCase().replace(/^.*\//, "");
  if (LLM_PRICES[id]) return { ...LLM_PRICES[id], matched: id };
  const undated = id.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (undated !== id && LLM_PRICES[undated]) {
    return { ...LLM_PRICES[undated], matched: undated, note: `priced as ${undated}` };
  }
  const alias = ALIASES[id];
  if (alias) return { ...LLM_PRICES[alias.to], matched: alias.to, note: alias.note };
  const key = claudeKey(id);
  if (key && CLAUDE_PRICES[key]) return { ...CLAUDE_PRICES[key], matched: `claude ${key}` };
  const geminiBase = id.replace(/-(latest|\d{3})$/, "");
  if (geminiBase !== id && LLM_PRICES[geminiBase]) {
    return { ...LLM_PRICES[geminiBase], matched: geminiBase, note: `priced as ${geminiBase}` };
  }
  return null;
}

/** USD per page, first tier. */
export const OCR_PRICES: Record<string, { per_page: number; source: string; note: string }> = {
  "textract:detect_document_text": { per_page: 0.0015, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_document_forms": { per_page: 0.05, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_document_tables": { per_page: 0.015, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_document_queries": { per_page: 0.015, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_document_forms_tables_queries": { per_page: 0.07, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_expense": { per_page: 0.01, source: TEXTRACT, note: "first tier, US West (Oregon)" },
  "textract:analyze_id": { per_page: 0.025, source: TEXTRACT, note: "first tier, US West (Oregon)" },
};

export function lookupOcrPrice(service: string) {
  return OCR_PRICES[service.trim().toLowerCase()] ?? null;
}

export const DREX_MODEL = "drex-v2.0";
/** https://console.nace.ai/models */
export const DREX_USD_PER_M_INPUT = 0.06;

/** Credits per page; ground is per target on each file. */
export const NDI_CREDITS_PER_UNIT: Record<NdiTool, number> = {
  parse: 1,
  split: 1,
  classify: 2,
  extract: 3,
  ground: 5,
};

export function ndiCredits(step: Extract<CostAfterStep, { handler: "ndi" }>): number {
  if (step.tool === "ground") return NDI_CREDITS_PER_UNIT.ground * (step.targets ?? 1);
  const credits = NDI_CREDITS_PER_UNIT[step.tool] * step.pages;
  return step.parse_mode === "high" ? credits * 2 : credits;
}

export interface CostEstimate {
  /** USD per call today; null when it could not be estimated. */
  before_usd: number | null;
  /** USD per call on the new path, excluding NDI when no price per credit is set; null when an LLM step could not be priced. */
  after_usd: number | null;
  /** NDI credits per call. */
  ndi_credits: number;
  /** False when the new path has NDI steps and no price per credit was given. */
  ndi_priced: boolean;
  notes: string[];
}

const perMillion = (tokens: number, usdPerMillion: number) => (tokens / 1_000_000) * usdPerMillion;

function llmCost(model: string, input: number, output: number, notes: string[]): number | null {
  const price = lookupLlmPrice(model);
  if (!price) {
    notes.push(`${model}: not on the price list, not estimated`);
    return null;
  }
  if (price.note) notes.push(`${model}: ${price.note}`);
  return perMillion(input, price.input) + perMillion(output, price.output);
}

export function estimateCost(cost: CostBlock, ndiUsdPerCredit: number | null): CostEstimate {
  const notes: string[] = [];
  const b = cost.before;
  let before_usd: number | null;
  if (b.kind === "llm") {
    before_usd = llmCost(b.model, b.input_tokens, b.output_tokens, notes);
  } else if (b.kind === "local") {
    before_usd = 0;
  } else {
    const price = lookupOcrPrice(b.service);
    before_usd = price ? price.per_page * b.pages : null;
    if (!price) notes.push(`${b.service}: no published per-page price, not estimated`);
  }

  let after_usd: number | null = 0;
  let ndi_credits = 0;
  for (const step of cost.after) {
    if (step.handler === "drex") {
      if (after_usd !== null) after_usd += perMillion(step.input_tokens, DREX_USD_PER_M_INPUT);
    } else if (step.handler === "ndi") {
      ndi_credits += ndiCredits(step);
    } else {
      const c = llmCost(step.model, step.input_tokens, step.output_tokens, notes);
      after_usd = after_usd === null || c === null ? null : after_usd + c;
    }
  }

  const hasNdi = cost.after.some((s) => s.handler === "ndi");
  if (hasNdi && ndiUsdPerCredit !== null && after_usd !== null) after_usd += ndi_credits * ndiUsdPerCredit;
  if (hasNdi && ndiUsdPerCredit === null) {
    notes.push("NDI price per credit not set (NACE_NDI_USD_PER_CREDIT); NDI shown in credits only");
  }
  return { before_usd, after_usd, ndi_credits, ndi_priced: !hasNdi || ndiUsdPerCredit !== null, notes };
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n < 0.000001) return "<$0.000001";
  return `$${parseFloat(n.toPrecision(3))}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/pricing.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/pricing.ts tests/pricing.test.ts
git commit -m "Add nace types and the dated price list with cost arithmetic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Detection patterns for raw HTTP calls and document pipelines

**Files:**
- Modify: `src/tools/patterns.ts` (interface at lines 14-37; entries array; `getDetectionPatterns`)
- Test: `tests/patterns.test.ts`, `tests/helpers/match.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProviderPattern` gains `kind: "llm" | "document"`; new entries with providers `raw_http_llm` (language `any`), `pdf_text`, `local_ocr`, `doc_parsers`, `cloud_ocr` (each for `python` and `typescript`); `export const LLM_FILE_INPUT_PATTERNS: string[]`.

- [ ] **Step 1: Write the test helper and the failing tests**

`tests/helpers/match.ts`:

```ts
import type { ProviderPattern } from "../../src/tools/patterns.js";

/** grep -E patterns use [[:space:]]; JS RegExp needs \s. */
export const toJs = (pattern: string) => new RegExp(pattern.replaceAll("[[:space:]]", "\\s"), "m");

/** usage_guide.rules: a file uses a provider if an import or a strong call pattern matches. */
export function usesProvider(entry: ProviderPattern, source: string): boolean {
  return [...entry.import_patterns, ...entry.strong_call_patterns].some((p) => toJs(p).test(source));
}
```

`tests/patterns.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PATTERNS, LLM_FILE_INPUT_PATTERNS, getDetectionPatterns } from "../src/tools/patterns.js";
import { toJs, usesProvider } from "./helpers/match.js";

const entry = (provider: string, language: string) => {
  const e = AI_PROVIDER_PATTERNS.find((p) => p.provider === provider && p.language === language);
  if (!e) throw new Error(`no ${provider}/${language} entry`);
  return e;
};

const PY_PYPDF = 'from pypdf import PdfReader\n\nreader = PdfReader(path)\ntext = reader.pages[0].extract_text()\n';
const PY_FITZ_VARIABLE = "fitz = load_config()\ndoc = fitz.open(path)\n";
const PY_TEXTRACT = 'import boto3\n\ntextract = boto3.client("textract")\nresp = textract.analyze_expense(Document={"Bytes": data})\n';
const PY_AZURE = "from azure.ai.documentintelligence import DocumentIntelligenceClient\n";
const PY_GDOCAI = "from google.cloud import documentai\n";
const PY_TESSERACT = "import pytesseract\ntext = pytesseract.image_to_string(img)\n";
const PY_DOCLING = "from docling.document_converter import DocumentConverter\n";
const PY_RAW_HTTP = 'import requests\nr = requests.post("https://openrouter.ai/api/v1/chat/completions", json=payload)\n';
const PY_OPENAI_IMAGE = 'from openai import OpenAI\nclient = OpenAI()\nmsg = {"type": "image_url", "image_url": {"url": data_url}}\n';
const PY_BASE64_NO_LLM = "import base64\nencoded = base64.b64encode(raw)\n";
const TS_PDF_PARSE = "import { PDFParse } from 'pdf-parse';\nconst parser = new PDFParse({ data: buf });\n";
const TS_TESSERACT = "import { createWorker } from 'tesseract.js';\nconst worker = await createWorker('eng');\n";
const TS_TEXTRACT = 'import { TextractClient, AnalyzeExpenseCommand } from "@aws-sdk/client-textract";\n';
const TS_RAW_FETCH = 'await fetch("https://api.anthropic.com/v1/messages", { method: "POST" });\n';
const TS_TWILIO = "import twilio from 'twilio';\nawait client.messages.create({ to, from, body });\n";
const TS_OWN_GENERATE = "import { generateText } from './text-utils';\nconst t = generateText(seed);\n";
const TS_VERCEL_FILE = "import { generateObject } from 'ai';\nconst part = { type: 'file', data: buf, mediaType: 'application/pdf' };\n";

describe("document providers", () => {
  it("detect PDF libraries only when imported", () => {
    expect(usesProvider(entry("pdf_text", "python"), PY_PYPDF)).toBe(true);
    expect(usesProvider(entry("pdf_text", "python"), PY_FITZ_VARIABLE)).toBe(false);
    expect(usesProvider(entry("pdf_text", "typescript"), TS_PDF_PARSE)).toBe(true);
  });
  it("detect OCR and parsers", () => {
    expect(usesProvider(entry("local_ocr", "python"), PY_TESSERACT)).toBe(true);
    expect(usesProvider(entry("local_ocr", "typescript"), TS_TESSERACT)).toBe(true);
    expect(usesProvider(entry("doc_parsers", "python"), PY_DOCLING)).toBe(true);
  });
  it("detect cloud OCR, including a boto3 Textract client", () => {
    expect(usesProvider(entry("cloud_ocr", "python"), PY_TEXTRACT)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "python"), PY_AZURE)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "python"), PY_GDOCAI)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "typescript"), TS_TEXTRACT)).toBe(true);
  });
  it("are tagged as documents", () => {
    for (const provider of ["pdf_text", "local_ocr", "doc_parsers", "cloud_ocr"]) {
      expect(entry(provider, "python").kind).toBe("document");
      expect(entry(provider, "typescript").kind).toBe("document");
    }
  });
});

describe("LLM providers", () => {
  it("detect raw HTTP calls without an SDK", () => {
    const raw = entry("raw_http_llm", "any");
    expect(raw.kind).toBe("llm");
    expect(usesProvider(raw, PY_RAW_HTTP)).toBe(true);
    expect(usesProvider(raw, TS_RAW_FETCH)).toBe(true);
  });
  it("still ignore lookalikes", () => {
    expect(usesProvider(entry("anthropic", "typescript"), TS_TWILIO)).toBe(false);
    expect(usesProvider(entry("vercel_ai", "typescript"), TS_OWN_GENERATE)).toBe(false);
  });
  it("are tagged as llm", () => {
    expect(entry("openai", "python").kind).toBe("llm");
    expect(entry("vercel_ai", "typescript").kind).toBe("llm");
  });
});

describe("LLM_FILE_INPUT_PATTERNS", () => {
  const fileInputCandidate = (source: string) =>
    AI_PROVIDER_PATTERNS.some((e) => e.kind === "llm" && usesProvider(e, source)) &&
    LLM_FILE_INPUT_PATTERNS.some((p) => toJs(p).test(source));

  it("flag files or images sent to an LLM", () => {
    expect(fileInputCandidate(PY_OPENAI_IMAGE)).toBe(true);
    expect(fileInputCandidate(TS_VERCEL_FILE)).toBe(true);
  });
  it("ignore the same words in files without an LLM provider", () => {
    expect(fileInputCandidate(PY_BASE64_NO_LLM)).toBe(false);
  });
});

describe("getDetectionPatterns", () => {
  it("includes language-neutral entries", () => {
    const py = getDetectionPatterns("python");
    expect(py.some((p) => p.provider === "raw_http_llm")).toBe(true);
    expect(py.every((p) => p.language === "python" || p.language === "any")).toBe(true);
  });
});

describe("grep -E compatibility", () => {
  const all = [
    ...AI_PROVIDER_PATTERNS.flatMap((e) => [...e.import_patterns, ...e.call_patterns, ...e.strong_call_patterns]),
    ...LLM_FILE_INPUT_PATTERNS,
  ];
  it.each(all)("compiles: %s", (pattern) => {
    const r = spawnSync("grep", ["-E", "-q", "--", pattern, "/dev/null"]);
    expect(r.status).not.toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/patterns.test.ts`
Expected: FAIL, `no pdf_text/python entry` and `LLM_FILE_INPUT_PATTERNS` undefined.

- [ ] **Step 3: Extend `src/tools/patterns.ts`**

In `interface ProviderPattern`, add after `language`:

```ts
  /** "llm" for model providers, "document" for PDF/OCR/document-AI libraries. */
  kind: "llm" | "document";
```

Add `kind: "llm",` to every existing entry (OpenAI v1, OpenAI legacy, Anthropic, LangChain, LlamaIndex, Cohere, Google GenAI, and the four TypeScript entries).

Append these entries to the end of `AI_PROVIDER_PATTERNS`:

```ts
  // ── Any language: LLM endpoints called without an SDK ────────────────────
  {
    provider: "raw_http_llm",
    language: "any",
    kind: "llm",
    import_patterns: [],
    call_patterns: [],
    strong_call_patterns: [
      "/v1/chat/completions",
      "/v1/messages",
      "/v1/responses",
      "api\\.openai\\.com",
      "api\\.anthropic\\.com",
      "openrouter\\.ai/api",
      "generativelanguage\\.googleapis\\.com",
    ],
    description: "LLM HTTP endpoints called with requests, httpx, fetch or axios instead of an SDK",
    extensions: [...PYTHON_EXTENSIONS, ...TS_JS_EXTENSIONS],
  },
  // ── Python: PDF text libraries ────────────────────────────────────────────
  {
    provider: "pdf_text",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+(pypdf|PyPDF2|pdfplumber|fitz|pymupdf|pdfminer)([[:space:].,]|$)",
    ],
    call_patterns: [
      "PdfReader\\(",
      "pdfplumber\\.open\\(",
      "fitz\\.open\\(",
      "pymupdf\\.open\\(",
      "extract_text\\(",
      "get_text\\(",
    ],
    strong_call_patterns: [],
    description: "PDF text extraction: pypdf, PyPDF2, pdfplumber, PyMuPDF (fitz), pdfminer",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: local OCR ─────────────────────────────────────────────────────
  {
    provider: "local_ocr",
    language: "python",
    kind: "document",
    import_patterns: ["^[[:space:]]*(from|import)[[:space:]]+(pytesseract|easyocr|paddleocr)([[:space:].,]|$)"],
    call_patterns: ["image_to_string\\(", "image_to_data\\(", "readtext\\(", "PaddleOCR\\(", "\\.ocr\\("],
    strong_call_patterns: [],
    description: "Local OCR: pytesseract, EasyOCR, PaddleOCR",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: document parsers ─────────────────────────────────────────────
  {
    provider: "doc_parsers",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+(unstructured|docling|llama_parse|llama_cloud_services|marker)([[:space:].,]|$)",
    ],
    call_patterns: ["partition(_pdf|_image|_docx)?\\(", "DocumentConverter\\(", "LlamaParse\\(", "load_data\\(", "PdfConverter\\("],
    strong_call_patterns: [],
    description: "Document parsers: unstructured, docling, LlamaParse, marker",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: cloud OCR ────────────────────────────────────────────────────
  {
    provider: "cloud_ocr",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+azure\\.ai\\.(formrecognizer|documentintelligence)",
      "^[[:space:]]*from[[:space:]]+google\\.cloud[[:space:]]+import[[:space:]]+documentai",
      "^[[:space:]]*(from|import)[[:space:]]+google\\.cloud\\.documentai",
    ],
    call_patterns: [
      "analyze_expense\\(",
      "analyze_document\\(",
      "detect_document_text\\(",
      "start_document_analysis\\(",
      "begin_analyze_document\\(",
      "process_document\\(",
    ],
    strong_call_patterns: ["client\\([[:space:]]*['\"]textract['\"]"],
    description: "Cloud OCR: AWS Textract (boto3), Azure Document Intelligence, Google Document AI",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── TypeScript/JS: PDF text libraries ────────────────────────────────────
  {
    provider: "pdf_text",
    language: "typescript",
    kind: "document",
    import_patterns: [...jsImport("pdf-parse"), ...jsImport("pdfjs-dist"), ...jsImport("pdf2json"), ...jsImport("unpdf")],
    call_patterns: ["new PDFParse\\(", "pdfParse\\(", "getDocument\\(", "getTextContent\\(", "getText\\(", "extractText\\("],
    strong_call_patterns: [],
    description: "PDF text extraction: pdf-parse, pdfjs-dist, pdf2json, unpdf",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: local OCR ─────────────────────────────────────────────
  {
    provider: "local_ocr",
    language: "typescript",
    kind: "document",
    import_patterns: jsImport("tesseract\\.js"),
    call_patterns: ["createWorker\\(", "\\.recognize\\("],
    strong_call_patterns: [],
    description: "Local OCR: tesseract.js",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: document parsers ──────────────────────────────────────
  {
    provider: "doc_parsers",
    language: "typescript",
    kind: "document",
    import_patterns: [...jsImport("llama-cloud-services"), ...jsImport("llamaindex")],
    call_patterns: ["LlamaParseReader", "LlamaParse\\(", "loadData\\("],
    strong_call_patterns: [],
    description: "Document parsers: LlamaParse (llama-cloud-services, llamaindex)",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: cloud OCR ─────────────────────────────────────────────
  {
    provider: "cloud_ocr",
    language: "typescript",
    kind: "document",
    import_patterns: [
      ...jsImport("@aws-sdk/client-textract"),
      ...jsImport("@azure/ai-form-recognizer"),
      ...jsImport("@azure-rest/ai-document-intelligence"),
      ...jsImport("@google-cloud/documentai"),
    ],
    call_patterns: [
      "AnalyzeExpenseCommand",
      "AnalyzeDocumentCommand",
      "DetectDocumentTextCommand",
      "beginAnalyzeDocument",
      "processDocument\\(",
    ],
    strong_call_patterns: [],
    description: "Cloud OCR: AWS Textract, Azure Document Intelligence, Google Document AI",
    extensions: TS_JS_EXTENSIONS,
  },
```

After the array, add:

```ts
/**
 * In a file that uses an LLM provider, a match means the call sends a file or
 * image to the model, so it is a candidate for NDI. Ignore matches in files
 * without an LLM provider.
 */
export const LLM_FILE_INPUT_PATTERNS = [
  "image_url",
  "input_image",
  "input_file",
  "['\"]?type['\"]?[[:space:]]*:[[:space:]]*['\"](image|file|document)['\"]",
  "application/pdf",
  "base64",
];
```

`getDetectionPatterns` already keeps `language === "any"` entries; leave it as is.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/patterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/patterns.ts tests/patterns.test.ts tests/helpers/match.ts
git commit -m "Detect raw HTTP LLM calls, document pipelines and files sent to LLMs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: nace-sdk templates

**Files:**
- Create: `src/tools/snippets.ts`
- Rewrite: `src/tools/templates.ts`
- Test: `tests/templates.test.ts`

**Interfaces:**
- Consumes: `NaceType`, `Language` from `src/tools/types.ts`.
- Produces (`snippets.ts`): `interface LegacyTask`, `interface Scenario`, `SCENARIOS: Scenario[]` (one per `NaceType`, in `NACE_TYPES` order), `programFor(s: Scenario, language: Language): string`.
- Produces (`templates.ts`): `interface IntegrationTemplate { opportunity_type: NaceType; provider: string; language: Language; description: string; dependency: "nace-sdk"; install: string; env_var: "NACE_API_KEY"; setup_snippet: string; before_snippet: string; after_snippet: string; notes: string[] }`, `TEMPLATES`, `getTemplates(filters?)`, `interface TemplateMatch { template; exact_match: boolean }`, `getBestTemplate(type: NaceType, provider: string, language: Language): TemplateMatch | undefined`.

After this task `npm run typecheck` fails (analyzer and index still import the old `OpportunityType`); that is expected until Task 6.

- [ ] **Step 1: Write the failing tests**

`tests/templates.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { SCENARIOS, programFor } from "../src/tools/snippets.js";
import { TEMPLATES, getBestTemplate } from "../src/tools/templates.js";
import { NACE_TYPES } from "../src/tools/types.js";

const pythonParses = (code: string) =>
  spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: code, encoding: "utf8" });
const tsParses = (code: string) => transformSync(code, { loader: "ts", format: "esm", target: "es2022" });

describe("scenarios", () => {
  it("cover every nace type once, in order", () => {
    expect(SCENARIOS.map((s) => s.type)).toEqual([...NACE_TYPES]);
  });
  it.each(SCENARIOS.map((s) => [s.type, s] as const))("%s python program parses", (_t, s) => {
    const r = pythonParses(programFor(s, "python"));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
  it.each(SCENARIOS.map((s) => [s.type, s] as const))("%s typescript program parses", (_t, s) => {
    expect(() => tsParses(programFor(s, "typescript"))).not.toThrow();
  });
  it("use nace-sdk", () => {
    for (const s of SCENARIOS) {
      expect(s.setup.python).toContain("from nace_sdk import");
      expect(s.setup.typescript).toContain('from "nace-sdk"');
    }
  });
});

describe("templates", () => {
  it("exist for every type, generator and parse extra", () => {
    expect(TEMPLATES).toHaveLength(8 * 5 + 4);
  });
  it.each(TEMPLATES.map((t) => [`${t.opportunity_type} ${t.provider} ${t.language}`, t] as const))(
    "%s before_snippet parses",
    (_name, t) => {
      if (t.language === "python") expect(pythonParses(t.before_snippet).status).toBe(0);
      else expect(() => tsParses(t.before_snippet)).not.toThrow();
    },
  );
  it("never mention ScaleDown", () => {
    expect(JSON.stringify(TEMPLATES).toLowerCase()).not.toContain("scaledown");
  });
});

describe("getBestTemplate", () => {
  it("finds an exact match", () => {
    const m = getBestTemplate("drex_choice", "anthropic", "python");
    expect(m?.exact_match).toBe(true);
    expect(m?.template.before_snippet).toContain("client.messages.create");
    expect(m?.template.after_snippet).toContain("nace.system_one");
  });
  it("falls back to openai in the same language", () => {
    const m = getBestTemplate("ndi_extract", "langchain", "python");
    expect(m?.exact_match).toBe(false);
    expect(m?.template.provider).toBe("openai");
    expect(m?.template.language).toBe("python");
  });
  it("has local-library templates for parse", () => {
    expect(getBestTemplate("ndi_parse", "pdf_text", "typescript")?.template.before_snippet).toContain("pdf-parse");
    expect(getBestTemplate("ndi_parse", "local_ocr", "python")?.template.before_snippet).toContain("pytesseract");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/templates.test.ts`
Expected: FAIL, cannot resolve `../src/tools/snippets.js`.

- [ ] **Step 3: Write `src/tools/snippets.ts`**

Method names and result fields follow the nace-sdk docs (`https://drex.nace.ai/docs/developer-tools/python` and `/typescript`, read 2026-10-15): `system_one` / `systemOne`, `Choice`/`Noul`/`Score` and `choice()`/`noul()`/`score()`, `result.choices[id].choice`, `.nouls[id].noul`, `.scores[id].score`; `documents.upload(...)` then `as_source()` / `workspaceFile(file)`, `wait_seconds`, `jobs.wait(job_id)`, `job.result["document"]["markdown"]`, `["segments"]`, `["units"][i]["labels"][0]["class_id"]`, `["data"]`/`["fields"]`, `["targets"][i]["matches"]`.

```ts
import type { Language, NaceType } from "./types.js";

/** The call being replaced, used to generate before_snippets. */
export interface LegacyTask {
  /** What the old prompt told the model. Plain words: no quotes or backslashes. */
  instruction: string;
  input: "text" | "file";
  /** Variable holding the text, or the path of the file. */
  inputVar: Record<Language, string>;
  /** True when the old call asked for JSON output. */
  json: boolean;
  /** Python statement reading the answer from `raw`, the model's text output. */
  readPy: string;
  /** TypeScript statement reading the answer from `raw`. */
  readTs: string;
  /** zod schema for the Vercel AI SDK's generateObject; null means generateText. */
  zodSchema: string | null;
  /** TypeScript statement reading the answer from generateObject's `object`. */
  readObject: string;
}

export interface Scenario {
  type: NaceType;
  description: string;
  task: LegacyTask;
  setup: Record<Language, string>;
  after: Record<Language, string>;
  /** Defines the input variable; used by the syntax tests and the live check. */
  fixture: Record<Language, string>;
  /** Prints the result; used by the live check. */
  livePrint: Record<Language, string>;
  notes: string[];
}

const PY_CLIENT = "nace = NaceClient()  # reads NACE_API_KEY";
const TS_CLIENT = "const nace = new NaceClient(); // reads NACE_API_KEY";

const PY_FILE_SETUP = `from nace_sdk import NaceClient\n\n${PY_CLIENT}`;
const TS_FILE_SETUP = `import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { NaceClient, workspaceFile } from "nace-sdk";

${TS_CLIENT}`;

const PY_TICKET = 'ticket_text = "I was charged twice for my March invoice."';
const TS_TICKET = 'const ticketText = "I was charged twice for my March invoice.";';
const PY_PDF = 'pdf_path = "tests/fixtures/sample-invoice.pdf"';
const TS_PDF = 'const pdfPath = "tests/fixtures/sample-invoice.pdf";';

const PY_UPLOAD = 'uploaded = nace.documents.upload(pdf_path, on_conflict="new_version")';
const TS_UPLOAD = `const uploaded = await nace.documents.upload(await openAsBlob(pdfPath), {
  file_name: basename(pdfPath),
  on_conflict: "new_version",
});`;
const PY_WAIT = `if job.status != "succeeded":
    job = nace.jobs.wait(job.job_id)  # raises if the job failed`;
const TS_WAIT = 'const job = created.status === "succeeded" ? created : await nace.jobs.wait(created.job_id);';

const fileTask = (instruction: string, json: boolean, readPy: string, readTs: string, zodSchema: string | null, readObject: string): LegacyTask => ({
  instruction,
  input: "file",
  inputVar: { python: "pdf_path", typescript: "pdfPath" },
  json,
  readPy,
  readTs,
  zodSchema,
  readObject,
});

const FILE_NOTES = [
  "For a public https URL, pass the URL string as the source and skip the upload.",
  "If you hold the bytes (for example multer's file.buffer), upload new Blob([buffer]) in TypeScript or the bytes in Python, with a file_name that keeps the extension.",
  "PDF, images (png, jpg, tiff, webp), Word, Excel, PowerPoint, HTML, email and plain text are accepted.",
  "Reuse one parse in later tools with a parse_result source so the file is not parsed and billed twice.",
];

export const SCENARIOS: Scenario[] = [
  {
    type: "drex_choice",
    description: "Replace an LLM call that picks one label from a fixed set with a Drex choice question",
    task: {
      instruction: "Classify the support ticket as billing, technical or general. Reply with JSON containing a category field.",
      input: "text",
      inputVar: { python: "ticket_text", typescript: "ticketText" },
      json: true,
      readPy: 'category = json.loads(raw)["category"]',
      readTs: "const category = JSON.parse(raw).category;",
      zodSchema: 'z.object({ category: z.enum(["billing", "technical", "general"]) })',
      readObject: "const category = object.category;",
    },
    setup: {
      python: `from nace_sdk import Choice, NaceClient\n\n${PY_CLIENT}`,
      typescript: `import { choice, NaceClient } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=ticket_text,
    questions={
        "category": Choice(
            instructions="Which team should handle this support ticket?",
            criteria={
                "billing": "Payments, invoices, refunds or pricing",
                "technical": "Bugs, errors or problems using the product",
                "general": "Anything else",
            },
        ),
    },
)
answer = result.choices["category"]
category = answer.choice  # one of the criteria keys: the old labels
confidence = answer.confidence`,
      typescript: `const { answers } = await nace.systemOne({
  state: ticketText,
  questions: {
    category: choice("Which team should handle this support ticket?", {
      billing: "Payments, invoices, refunds or pricing",
      technical: "Bugs, errors or problems using the product",
      general: "Anything else",
    }),
  },
});
const category = answers.category.choice; // "billing" | "technical" | "general"
const confidence = answers.category.confidence;`,
    },
    fixture: { python: PY_TICKET, typescript: TS_TICKET },
    livePrint: { python: "print(category, round(confidence, 3))", typescript: "console.log(category, confidence.toFixed(3));" },
    notes: [
      "Keep the old labels as the criteria keys so callers do not change.",
      "Drex reads the descriptions, not the key names: describe every label.",
      "answer.probabilities has a calibrated probability for every label; use it instead of asking the model for a confidence.",
      "Several judgments about the same state fit in one request (up to 512 questions).",
    ],
  },
  {
    type: "drex_noul",
    description: "Replace an LLM yes/no check with a Drex noul question",
    task: {
      instruction: "Decide whether the message is spam. Reply with JSON containing a boolean is_spam field.",
      input: "text",
      inputVar: { python: "message_text", typescript: "messageText" },
      json: true,
      readPy: 'is_spam = json.loads(raw)["is_spam"]',
      readTs: "const isSpam: boolean = JSON.parse(raw).is_spam;",
      zodSchema: "z.object({ is_spam: z.boolean() })",
      readObject: "const isSpam = object.is_spam;",
    },
    setup: {
      python: `from nace_sdk import NaceClient, Noul\n\n${PY_CLIENT}`,
      typescript: `import { NaceClient, noul } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=message_text,
    questions={
        "is_spam": Noul(instructions="Is this message unsolicited advertising or a scam?"),
    },
)
p_spam = result.nouls["is_spam"].noul  # probability of yes, 0 to 1
is_spam = p_spam >= 0.5  # choose the threshold from your own labeled examples`,
      typescript: `const { answers } = await nace.systemOne({
  state: messageText,
  questions: {
    is_spam: noul("Is this message unsolicited advertising or a scam?"),
  },
});
const pSpam = answers.is_spam.noul; // probability of yes, 0 to 1
const isSpam = pSpam >= 0.5; // choose the threshold from your own labeled examples`,
    },
    fixture: {
      python: 'message_text = "Congratulations! You won a free cruise. Click here to claim your prize."',
      typescript: 'const messageText = "Congratulations! You won a free cruise. Click here to claim your prize.";',
    },
    livePrint: { python: "print(round(p_spam, 3), is_spam)", typescript: "console.log(pSpam.toFixed(3), isSpam);" },
    notes: [
      "noul is the probability of yes. 0.5 is only a starting threshold; pick yours from labeled examples.",
      "When the instructions alone are ambiguous, describe both outcomes with criteria={'true': ..., 'false': ...}.",
    ],
  },
  {
    type: "drex_score",
    description: "Replace an LLM rating on a fixed scale with a Drex score question",
    task: {
      instruction: "Rate the urgency of the support ticket from 0 (not urgent) to 3 (critical). Reply with JSON containing an integer urgency field.",
      input: "text",
      inputVar: { python: "ticket_text", typescript: "ticketText" },
      json: true,
      readPy: 'urgency = int(json.loads(raw)["urgency"])',
      readTs: "const urgency = Number(JSON.parse(raw).urgency);",
      zodSchema: "z.object({ urgency: z.number().int().min(0).max(3) })",
      readObject: "const urgency = object.urgency;",
    },
    setup: {
      python: `from nace_sdk import NaceClient, Score\n\n${PY_CLIENT}`,
      typescript: `import { NaceClient, score } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=ticket_text,
    questions={
        "urgency": Score(
            instructions="How urgent is this support ticket?",
            criteria=[
                "Not urgent: a question or request with no deadline",
                "Somewhat urgent: a problem with a workaround",
                "Urgent: the customer is blocked",
                "Critical: outage, data loss or a security issue",
            ],
        ),
    },
)
urgency = result.scores["urgency"].score  # expected level, 0 to 3; can fall between levels
urgency_level = round(urgency)`,
      typescript: `const { answers } = await nace.systemOne({
  state: ticketText,
  questions: {
    urgency: score("How urgent is this support ticket?", [
      "Not urgent: a question or request with no deadline",
      "Somewhat urgent: a problem with a workaround",
      "Urgent: the customer is blocked",
      "Critical: outage, data loss or a security issue",
    ]),
  },
});
const urgency = answers.urgency.score; // expected level, 0 to 3; can fall between levels
const urgencyLevel = Math.round(urgency);`,
    },
    fixture: {
      python: 'ticket_text = "Our whole team is locked out of the dashboard and we have a client demo in an hour."',
      typescript: 'const ticketText = "Our whole team is locked out of the dashboard and we have a client demo in an hour.";',
    },
    livePrint: { python: "print(round(urgency, 2), urgency_level)", typescript: "console.log(urgency.toFixed(2), urgencyLevel);" },
    notes: [
      "score is the expected level and can fall between levels; round it where the old code used integers.",
      "Write one concrete description per level, lowest first.",
    ],
  },
  {
    type: "ndi_parse",
    description: "Replace PDF text extraction, OCR or a 'transcribe this page' vision prompt with NDI parse",
    task: fileTask("Transcribe all text in this document.", false, "text = raw", "const text = raw;", null, ""),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.parse(uploaded.as_source(), wait_seconds=60)
${PY_WAIT}
text = job.result["document"]["markdown"]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.parse({ source: workspaceFile(uploaded), wait_seconds: 60 });
${TS_WAIT}
const text = (job.result as { document: { markdown: string } }).document.markdown;`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(text[:200])", typescript: "console.log(text.slice(0, 200));" },
    notes: [
      ...FILE_NOTES,
      'parse_mode="high" adds page verification and OCR correction at twice the credits; the default is "low".',
    ],
  },
  {
    type: "ndi_split",
    description: "Replace an LLM prompt that finds the documents inside a multi-document file with NDI split",
    task: fileTask(
      "This file contains several documents. List each one with its first page, last page and type (invoice or receipt) as JSON in a documents field.",
      true,
      'segments = json.loads(raw)["documents"]',
      "const segments = JSON.parse(raw).documents;",
      'z.object({ documents: z.array(z.object({ start_page: z.number(), end_page: z.number(), type: z.enum(["invoice", "receipt"]) })) })',
      "const segments = object.documents;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.split(
    uploaded.as_source(),
    classes=[
        {"id": "invoice", "label": "Invoice", "description": "A supplier invoice"},
        {"id": "receipt", "label": "Receipt", "description": "A payment receipt"},
    ],
    wait_seconds=60,
)
${PY_WAIT}
segments = [
    {
        "start_page": s["start_page"],
        "end_page": s["end_page"],
        "type": s["class"]["id"] if s["class"] else None,
    }
    for s in job.result["segments"]
]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.split({
  source: workspaceFile(uploaded),
  classes: [
    { id: "invoice", label: "Invoice", description: "A supplier invoice" },
    { id: "receipt", label: "Receipt", description: "A payment receipt" },
  ],
  wait_seconds: 60,
});
${TS_WAIT}
type Segment = { start_page: number; end_page: number; class: { id: string } | null };
const segments = (job.result as { segments: Segment[] }).segments.map((s) => ({
  start_page: s.start_page,
  end_page: s.end_page,
  type: s.class?.id ?? null,
}));`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(segments)", typescript: "console.log(segments);" },
    notes: [
      ...FILE_NOTES,
      "Class ids must be unique and cannot contain '/'; blank_page, unreadable_content and __ndi_unclassified are reserved.",
      'unknown_policy="force" gives every page a class when the old code never returned "unknown".',
    ],
  },
  {
    type: "ndi_classify",
    description: "Replace an LLM prompt that decides what type of document a file is with NDI classify",
    task: fileTask(
      "What type of document is this: invoice, receipt or resume? Reply with JSON containing a document_type field.",
      true,
      'document_type = json.loads(raw)["document_type"]',
      "const documentType = JSON.parse(raw).document_type;",
      'z.object({ document_type: z.enum(["invoice", "receipt", "resume"]) })',
      "const documentType = object.document_type;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.classify(
    uploaded.as_source(),
    classes=[
        {"id": "invoice", "label": "Invoice", "description": "A bill from a supplier asking for payment"},
        {"id": "receipt", "label": "Receipt", "description": "Proof that a payment was made"},
        {"id": "resume", "label": "Resume", "description": "A CV describing a person's work history"},
    ],
    unknown_policy="force_best",  # always one of the classes, like the old code
    wait_seconds=60,
)
${PY_WAIT}
best = job.result["units"][0]["labels"][0]
document_type = best["class_id"]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.classify({
  source: workspaceFile(uploaded),
  classes: [
    { id: "invoice", label: "Invoice", description: "A bill from a supplier asking for payment" },
    { id: "receipt", label: "Receipt", description: "Proof that a payment was made" },
    { id: "resume", label: "Resume", description: "A CV describing a person's work history" },
  ],
  unknown_policy: "force_best", // always one of the classes, like the old code
  wait_seconds: 60,
});
${TS_WAIT}
type Unit = { labels: Array<{ class_id: string }> };
const documentType = (job.result as { units: Unit[] }).units[0].labels[0].class_id;`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(document_type)", typescript: "console.log(documentType);" },
    notes: [
      ...FILE_NOTES,
      'granularity="page" labels each page instead of the whole file.',
      "'other' is a reserved class id; give a catch-all class another id.",
    ],
  },
  {
    type: "ndi_extract",
    description: "Replace an LLM call that fills fields from a document with NDI extract (fields come with citations)",
    task: fileTask(
      "Extract the invoice number, invoice date and total from this invoice. Reply with JSON.",
      true,
      "data = json.loads(raw)",
      "const data = JSON.parse(raw);",
      "z.object({ invoice_number: z.string(), invoice_date: z.string(), total: z.number() })",
      "const data = object;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.extract(
    uploaded.as_source(),
    schema={
        "type": "object",
        "properties": {
            "invoice_number": {"type": "string"},
            "invoice_date": {"type": "string", "description": "ISO date, YYYY-MM-DD"},
            "total": {"type": "number"},
        },
        "required": ["invoice_number", "invoice_date", "total"],
    },
    wait_seconds=60,
)
${PY_WAIT}
data = job.result["data"]  # shaped by the schema
fields = job.result["fields"]  # per field: path, value, status, confidence, citations`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.extract({
  source: workspaceFile(uploaded),
  schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      invoice_date: { type: "string", description: "ISO date, YYYY-MM-DD" },
      total: { type: "number" },
    },
    required: ["invoice_number", "invoice_date", "total"],
  },
  wait_seconds: 60,
});
${TS_WAIT}
const result = job.result as { data: Record<string, unknown>; fields: unknown[] };
const data = result.data; // shaped by the schema
const fields = result.fields; // per field: path, value, status, confidence, citations`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(data)", typescript: "console.log(data);" },
    notes: [
      ...FILE_NOTES,
      "If the old code used a zod schema, convert it with z.toJSONSchema(schema) (zod 4) or the zod-to-json-schema package (zod 3).",
      "Each entry in fields has a status (found, not_found, ambiguous), a confidence and citations to the page and text: use them instead of asking the model for confidence scores.",
      "instructions= adds guidance but cannot add fields the schema does not list.",
    ],
  },
  {
    type: "ndi_ground",
    description: "Replace code or a prompt that finds where a value appears in a document with NDI ground",
    task: fileTask(
      "On which page does the amount 1,200.50 appear? Reply with JSON containing a page field.",
      true,
      'page = json.loads(raw)["page"]',
      "const page = Number(JSON.parse(raw).page);",
      "z.object({ page: z.number().int() })",
      "const page = object.page;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.ground(
    uploaded.as_source(),
    targets=[{"id": "total", "text": "1,200.50"}],
    wait_seconds=60,
)
${PY_WAIT}
target = job.result["targets"][0]
match = target["matches"][0] if target["matches"] else None
location = match["location"] if match else None  # page and polygons for a page_region`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.ground({
  source: workspaceFile(uploaded),
  targets: [{ id: "total", text: "1,200.50" }],
  wait_seconds: 60,
});
${TS_WAIT}
type Target = { id: string; status: string; matches: Array<{ location: unknown }> };
const target = (job.result as { targets: Target[] }).targets[0];
const location = target.matches[0]?.location ?? null; // page and polygons for a page_region`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: 'print(target["status"], location)', typescript: "console.log(target.status, location);" },
    notes: [
      ...FILE_NOTES,
      "Up to 30 targets per job; each costs 5 credits on each file.",
      "Add a hint (nearby text) to a target whose quote appears more than once.",
    ],
  },
];

/** setup + fixture + after + print: a runnable program for the syntax tests and the live check. */
export function programFor(s: Scenario, language: Language): string {
  return [s.setup[language], s.fixture[language], s.after[language], s.livePrint[language]].join("\n\n") + "\n";
}
```

- [ ] **Step 4: Rewrite `src/tools/templates.ts`**

```ts
import { SCENARIOS, type LegacyTask, type Scenario } from "./snippets.js";
import type { Language, NaceType } from "./types.js";

export interface IntegrationTemplate {
  opportunity_type: NaceType;
  provider: string;
  language: Language;
  description: string;
  dependency: "nace-sdk";
  install: string;
  env_var: "NACE_API_KEY";
  setup_snippet: string;
  before_snippet: string;
  after_snippet: string;
  notes: string[];
}

const COMMON_NOTES = [
  "nace-sdk raises on failure (NaceError and its subclasses). Decide the failure path explicitly; do not fall back to the old provider silently.",
  "One NACE_API_KEY (nace_sk_...) covers Drex and NDI. Create it at https://drex.nace.ai.",
];

function openaiPython(t: LegacyTask): string {
  const v = t.inputVar.python;
  const format = t.json ? '\n    response_format={"type": "json_object"},' : "";
  const call =
    t.input === "text"
      ? `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "${t.instruction}"},
        {"role": "user", "content": ${v}},
    ],${format}
)`
      : `with open(${v}, "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "${t.instruction}"},
                {"type": "file", "file": {"filename": "document.pdf", "file_data": "data:application/pdf;base64," + pdf_b64}},
            ],
        }
    ],${format}
)`;
  return `${call}\nraw = response.choices[0].message.content\n${t.readPy}`;
}

function anthropicPython(t: LegacyTask): string {
  const v = t.inputVar.python;
  const call =
    t.input === "text"
      ? `message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    system="${t.instruction}",
    messages=[{"role": "user", "content": ${v}}],
)`
      : `with open(${v}, "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()
message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64}},
                {"type": "text", "text": "${t.instruction}"},
            ],
        }
    ],
)`;
  return `${call}\nraw = message.content[0].text\n${t.readPy}`;
}

function openaiTypescript(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const format = t.json ? '\n  response_format: { type: "json_object" },' : "";
  const call =
    t.input === "text"
      ? `const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "${t.instruction}" },
    { role: "user", content: ${v} },
  ],${format}
});`
      : `const pdfB64 = readFileSync(${v}).toString("base64");
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "${t.instruction}" },
        { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64," + pdfB64 } },
      ],
    },
  ],${format}
});`;
  return `${call}\nconst raw = response.choices[0].message.content ?? "";\n${t.readTs}`;
}

function anthropicTypescript(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const call =
    t.input === "text"
      ? `const message = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: "${t.instruction}",
  messages: [{ role: "user", content: ${v} }],
});`
      : `const pdfB64 = readFileSync(${v}).toString("base64");
const message = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
        { type: "text", text: "${t.instruction}" },
      ],
    },
  ],
});`;
  return `${call}\nconst first = message.content[0];\nconst raw = first.type === "text" ? first.text : "";\n${t.readTs}`;
}

function vercelAi(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const input =
    t.input === "text"
      ? `  prompt: "${t.instruction}\\n\\n" + ${v},`
      : `  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "${t.instruction}" },
        { type: "file", data: readFileSync(${v}), mediaType: "application/pdf" },
      ],
    },
  ],`;
  if (t.zodSchema === null) {
    return `const { text: raw } = await generateText({\n  model: openai("gpt-4o"),\n${input}\n});\n${t.readTs}`;
  }
  return `const { object } = await generateObject({\n  model: openai("gpt-4o"),\n  schema: ${t.zodSchema},\n${input}\n});\n${t.readObject}`;
}

const GENERATORS: Array<[provider: string, language: Language, generate: (t: LegacyTask) => string]> = [
  ["openai", "python", openaiPython],
  ["anthropic", "python", anthropicPython],
  ["openai", "typescript", openaiTypescript],
  ["anthropic", "typescript", anthropicTypescript],
  ["vercel_ai", "typescript", vercelAi],
];

/** Local libraries replaced by NDI parse. */
const PARSE_EXTRAS: Array<[provider: string, language: Language, before: string]> = [
  ["pdf_text", "python", `from pypdf import PdfReader\n\nreader = PdfReader(pdf_path)\ntext = "\\n".join(page.extract_text() or "" for page in reader.pages)`],
  [
    "pdf_text",
    "typescript",
    `import { readFileSync } from "node:fs";\nimport { PDFParse } from "pdf-parse";\n\nconst parser = new PDFParse({ data: readFileSync(pdfPath) });\nconst { text } = await parser.getText();`,
  ],
  ["local_ocr", "python", `import pytesseract\nfrom PIL import Image\n\ntext = pytesseract.image_to_string(Image.open(pdf_path))`],
  [
    "local_ocr",
    "typescript",
    `import { createWorker } from "tesseract.js";\n\nconst worker = await createWorker("eng");\nconst { data: { text } } = await worker.recognize(pdfPath);\nawait worker.terminate();`,
  ],
];

function make(s: Scenario, provider: string, language: Language, before: string): IntegrationTemplate {
  return {
    opportunity_type: s.type,
    provider,
    language,
    description: s.description,
    dependency: "nace-sdk",
    install: language === "python" ? "pip install nace-sdk  # Python 3.11+" : "npm install nace-sdk",
    env_var: "NACE_API_KEY",
    setup_snippet: s.setup[language],
    before_snippet: before,
    after_snippet: s.after[language],
    notes: [...s.notes, ...COMMON_NOTES],
  };
}

export const TEMPLATES: IntegrationTemplate[] = SCENARIOS.flatMap((s) => [
  ...GENERATORS.map(([provider, language, generate]) => make(s, provider, language, generate(s.task))),
  ...(s.type === "ndi_parse" ? PARSE_EXTRAS.map(([provider, language, before]) => make(s, provider, language, before)) : []),
]);

export function getTemplates(filters?: { opportunity_type?: NaceType; provider?: string; language?: Language }): IntegrationTemplate[] {
  return TEMPLATES.filter(
    (t) =>
      (!filters?.opportunity_type || t.opportunity_type === filters.opportunity_type) &&
      (!filters?.provider || t.provider === filters.provider.toLowerCase()) &&
      (!filters?.language || t.language === filters.language),
  );
}

export interface TemplateMatch {
  template: IntegrationTemplate;
  /** true only when type, provider and language all match */
  exact_match: boolean;
}

/** The best template for a type: exact provider, else openai in the same language, else any. */
export function getBestTemplate(type: NaceType, provider: string, language: Language): TemplateMatch | undefined {
  const wanted = provider.toLowerCase();
  const exact = TEMPLATES.find((t) => t.opportunity_type === type && t.provider === wanted && t.language === language);
  if (exact) return { template: exact, exact_match: true };
  const fallback =
    TEMPLATES.find((t) => t.opportunity_type === type && t.language === language) ??
    TEMPLATES.find((t) => t.opportunity_type === type);
  return fallback ? { template: fallback, exact_match: false } : undefined;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/templates.test.ts`
Expected: PASS. If a Python program fails to parse, the test prints `ast` stderr naming the line; fix the snippet, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/tools/snippets.ts src/tools/templates.ts tests/templates.test.ts
git commit -m "Replace ScaleDown templates with nace-sdk templates for the eight nace types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Finding schema and the nace report

**Files:**
- Create: `src/schema.ts`, `tests/fixtures/findings.ts`
- Rewrite: `src/tools/analyzer.ts`
- Test: `tests/schema.test.ts`, `tests/analyzer.test.ts`

**Interfaces:**
- Consumes: `NACE_TYPES`, `NDI_TOOLS`, `TYPE_ALIASES`, `TYPE_LABELS`, `productOf` (Task 2); `estimateCost`, `formatUsd`, `DREX_MODEL`, `DREX_USD_PER_M_INPUT`, `PRICES_AS_OF`, `CostEstimate` (Task 2).
- Produces (`src/schema.ts`): `naceTypeSchema`, `opportunitySchema`, `decompositionStepSchema`, `costSchema`, `findingSchema`, `architectureOverviewSchema`, `type Finding = z.infer<typeof findingSchema>`, `type ArchitectureOverview`.
- Produces (`src/tools/analyzer.ts`): `interface ReportOptions { projectName?: string; filesScanned?: number; architecture?: ArchitectureOverview; ndiUsdPerCredit?: number | null; now?: Date }`, `generateMigrationPlanMarkdown(findings: Finding[], opts?: ReportOptions): string`.

- [ ] **Step 1: Write the fixtures and failing tests**

`tests/fixtures/findings.ts`:

```ts
import type { Finding } from "../../src/schema.js";

export const TICKET: Finding = {
  file_path: "src/services/classifier.py",
  line_number: 280,
  provider: "openai",
  process: "Ticket category",
  opportunities: [{ type: "drex_choice", confidence: "high", reason: "Picks one of 8 fixed categories and the router branches on it." }],
  complexity: { score: 2, label: "simple", reasons: ["One label from a fixed set"] },
  cost: {
    before: { kind: "llm", model: "gpt-4o", input_tokens: 900, output_tokens: 150 },
    after: [{ handler: "drex", input_tokens: 300 }],
    assumptions: ["ticket body ≈ 150 tokens"],
  },
  code_snippet: "response = await self.client.chat.completions.create(",
};

export const SENTIMENT: Finding = {
  file_path: "src/services/sentiment.py",
  line_number: 213,
  provider: "openai",
  process: "Ticket sentiment",
  opportunities: [{ type: "drex_choice", confidence: "medium", reason: "Rules branch on the sentiment label." }],
  complexity: { score: 2, label: "simple", reasons: ["One label"] },
  cost: {
    before: { kind: "llm", model: "llama-3.3-70b-versatile", input_tokens: 500, output_tokens: 60 },
    after: [{ handler: "drex", input_tokens: 200 }],
    assumptions: [],
  },
  code_snippet: "response = await self.client.chat.completions.create(",
};

export const INVOICE: Finding = {
  file_path: "src/extract.ts",
  line_number: 42,
  provider: "vercel_ai",
  process: "Invoice fields",
  opportunities: [
    { type: "ndi_extract", confidence: "high", reason: "Fills a fixed schema from an uploaded PDF." },
    { type: "drex_noul", confidence: "medium", reason: "The same prompt also flags printed PII." },
  ],
  complexity: {
    score: 3,
    label: "moderate",
    reasons: ["Extraction plus a PII flag in one prompt"],
    decomposition: [
      { step: 1, purpose: "Pull invoice fields", handler: "ndi", nace_type: "ndi_extract", notes: "Schema from the zod type" },
      { step: 2, purpose: "Flag printed PII", handler: "drex", nace_type: "drex_noul", notes: "One noul on the parsed text" },
    ],
  },
  cost: {
    before: { kind: "llm", model: "gpt-4o", input_tokens: 3000, output_tokens: 400 },
    after: [
      { handler: "ndi", tool: "extract", pages: 2 },
      { handler: "drex", input_tokens: 1200 },
    ],
    assumptions: ["invoices are 2 pages"],
  },
  code_snippet: "const { object } = await generateObject({",
};

export const REPLY: Finding = {
  file_path: "src/services/rag.py",
  line_number: 427,
  provider: "openai",
  process: "Suggested reply",
  opportunities: [],
  keep_reason: "Generates a free-text reply for the agent.",
  complexity: { score: 2, label: "simple", reasons: ["Generation"] },
  code_snippet: "response = await self.client.chat.completions.create(",
};
```

`tests/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findingSchema } from "../src/schema.js";
import { INVOICE, REPLY, TICKET } from "./fixtures/findings.js";

describe("findingSchema", () => {
  it("accepts the fixtures", () => {
    for (const f of [TICKET, INVOICE, REPLY]) expect(findingSchema.safeParse(f).success).toBe(true);
  });
  it("normalizes short type names", () => {
    const parsed = findingSchema.parse({
      ...INVOICE,
      opportunities: [{ type: "extract", confidence: "high", reason: "r" }],
      complexity: { ...INVOICE.complexity, decomposition: [{ step: 1, purpose: "p", handler: "drex", nace_type: "choice", notes: "n" }] },
    });
    expect(parsed.opportunities[0].type).toBe("ndi_extract");
    expect(parsed.complexity.decomposition?.[0].nace_type).toBe("drex_choice");
  });
  it("requires keep_reason when nothing moves", () => {
    const r = findingSchema.safeParse({ ...REPLY, keep_reason: undefined });
    expect(r.success).toBe(false);
  });
  it("rejects a decomposition step whose type belongs to the other product", () => {
    const r = findingSchema.safeParse({
      ...INVOICE,
      complexity: { ...INVOICE.complexity, decomposition: [{ step: 1, purpose: "p", handler: "drex", nace_type: "ndi_extract", notes: "n" }] },
    });
    expect(r.success).toBe(false);
  });
  it("requires nace_type on drex and ndi steps", () => {
    const r = findingSchema.safeParse({
      ...INVOICE,
      complexity: { ...INVOICE.complexity, decomposition: [{ step: 1, purpose: "p", handler: "ndi", notes: "n" }] },
    });
    expect(r.success).toBe(false);
  });
});
```

`tests/analyzer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateMigrationPlanMarkdown } from "../src/tools/analyzer.js";
import { INVOICE, REPLY, SENTIMENT, TICKET } from "./fixtures/findings.js";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const report = (ndiUsdPerCredit: number | null = null) =>
  generateMigrationPlanMarkdown([TICKET, SENTIMENT, INVOICE, REPLY], {
    projectName: "demo",
    filesScanned: 12,
    ndiUsdPerCredit,
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
    expect(md).toContain("| Same, with nace | $0.09 + 6,000 NDI credits |");
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
    expect(md).toContain("  - Cost per call: $0.0115 today → $0.000072 + 6 NDI credits with nace; per 1,000 calls $11.50 → $0.072 + 6,000 NDI credits");
  });

  it("prices NDI when a price per credit is given", () => {
    const md = report(0.01);
    expect(md).toContain("  - Cost per call: $0.0115 today → $0.0601 with nace; per 1,000 calls $11.50 → $60.07");
    expect(md).toContain("Priced at $0.01 per credit.");
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

  it("handles an empty scan", () => {
    const md = generateMigrationPlanMarkdown([], { projectName: "empty", now: NOW });
    expect(md).toContain("No AI or document-processing calls were found.");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/schema.test.ts tests/analyzer.test.ts`
Expected: FAIL, cannot resolve `../src/schema.js`.

- [ ] **Step 3: Write `src/schema.ts`**

```ts
import { z } from "zod";
import { NACE_TYPES, NDI_TOOLS, TYPE_ALIASES, productOf } from "./tools/types.js";

export const naceTypeSchema = z.preprocess(
  (v) => (typeof v === "string" ? (TYPE_ALIASES[v] ?? v) : v),
  z.enum(NACE_TYPES),
);

export const opportunitySchema = z.object({
  type: naceTypeSchema,
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
});

export const decompositionStepSchema = z
  .object({
    step: z.number().int().positive(),
    purpose: z.string(),
    handler: z.enum(["drex", "ndi", "llm"]),
    nace_type: naceTypeSchema.optional().describe('Required when handler is "drex" or "ndi"; must belong to that product.'),
    notes: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.handler === "llm") return;
    if (!d.nace_type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nace_type"], message: `nace_type is required when handler is "${d.handler}"` });
    } else if (productOf(d.nace_type) !== d.handler) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nace_type"], message: `${d.nace_type} is not a ${d.handler} type` });
    }
  });

const tokens = z.number().int().nonnegative();

export const costSchema = z.object({
  before: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("llm"), model: z.string(), input_tokens: tokens, output_tokens: tokens }),
    z.object({ kind: z.literal("ocr_service"), service: z.string(), pages: z.number().positive() }),
    z.object({ kind: z.literal("local"), library: z.string() }),
  ]),
  after: z
    .array(
      z.discriminatedUnion("handler", [
        z.object({ handler: z.literal("drex"), input_tokens: tokens }),
        z.object({
          handler: z.literal("ndi"),
          tool: z.enum(NDI_TOOLS),
          pages: z.number().positive(),
          targets: z.number().int().positive().optional(),
          parse_mode: z.enum(["low", "medium", "high"]).optional(),
        }),
        z.object({ handler: z.literal("llm"), model: z.string(), input_tokens: tokens, output_tokens: tokens }),
      ]),
    )
    .min(1),
  assumptions: z.array(z.string()),
});

export const findingSchema = z
  .object({
    file_path: z.string(),
    line_number: z.number().int().positive().nullable().optional(),
    provider: z.string(),
    process: z.string().describe("Short name of what this code does, e.g. 'Ticket category'."),
    opportunities: z.array(opportunitySchema).describe("Most confident first. Empty when the call stays on the LLM."),
    keep_reason: z.string().optional().describe("Required when opportunities is empty: why the call stays on the LLM."),
    complexity: z.object({
      score: z.number().int().min(1).max(5),
      label: z.string(),
      reasons: z.array(z.string()),
      decomposition: z.array(decompositionStepSchema).nullable().optional(),
    }),
    cost: costSchema.optional(),
    code_snippet: z.string(),
  })
  .superRefine((f, ctx) => {
    if (f.opportunities.length === 0 && !f.keep_reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["keep_reason"], message: "keep_reason is required when opportunities is empty" });
    }
  });

export const architectureOverviewSchema = z.object({
  description: z.string().describe("Plain-English summary of how and where AI and document processing are used."),
  patterns: z
    .array(
      z.object({
        name: z.string().describe("Short name, e.g. 'ticket routing', 'invoice intake'."),
        files: z.array(z.string()),
        provider: z.string(),
        purpose: z.string(),
      }),
    )
    .describe("Each distinct usage pattern."),
});

export type Finding = z.infer<typeof findingSchema>;
export type ArchitectureOverview = z.infer<typeof architectureOverviewSchema>;
```

- [ ] **Step 4: Rewrite `src/tools/analyzer.ts`**

```ts
import type { ArchitectureOverview, Finding } from "../schema.js";
import { DREX_MODEL, DREX_USD_PER_M_INPUT, PRICES_AS_OF, estimateCost, formatUsd, type CostEstimate } from "./pricing.js";
import { NACE_TYPES, TYPE_LABELS, productOf, type NaceType, type Product } from "./types.js";

export interface ReportOptions {
  projectName?: string;
  filesScanned?: number;
  architecture?: ArchitectureOverview;
  /** USD per NDI credit; null or undefined shows NDI in credits. */
  ndiUsdPerCredit?: number | null;
  /** Fixed time for reproducible output (tests). */
  now?: Date;
}

interface Site {
  finding: Finding;
  primary: NaceType;
  estimate: CostEstimate | null;
}

const credits = (n: number) => `${n.toLocaleString("en-US")} NDI credits`;
const money = (usd: number | null) => (usd === null ? "not estimated" : formatUsd(usd));
const location = (f: Finding) => (f.line_number ? `${f.file_path}:${f.line_number}` : f.file_path);

function newPath(e: Pick<CostEstimate, "after_usd" | "ndi_credits" | "ndi_priced">, times: number): string {
  if (e.after_usd === null) return "not estimated";
  if (e.ndi_priced || e.ndi_credits === 0) return formatUsd(e.after_usd * times);
  if (e.after_usd === 0) return credits(e.ndi_credits * times);
  return `${formatUsd(e.after_usd * times)} + ${credits(e.ndi_credits * times)}`;
}

function costLine(e: CostEstimate | null): string {
  if (!e) return "not estimated (no usage figures)";
  const per1k = e.before_usd === null ? null : e.before_usd * 1000;
  return `${money(e.before_usd)} today → ${newPath(e, 1)} with nace; per 1,000 calls ${money(per1k)} → ${newPath(e, 1000)}`;
}

function siteLines(s: Site): string {
  const f = s.finding;
  const top = f.opportunities[0];
  const lines = [
    `- **${f.process}** (\`${location(f)}\`): ${top.confidence} confidence, ${f.complexity.label} (${f.complexity.score}/5). ${top.reason}`,
    `  - Cost per call: ${costLine(s.estimate)}`,
  ];
  for (const o of f.opportunities.slice(1)) lines.push(`  - Also: ${o.type} (${o.confidence}): ${o.reason}`);
  if (f.cost?.assumptions.length) lines.push(`  - Assumptions: ${f.cost.assumptions.join("; ")}`);
  if (s.estimate?.notes.length) lines.push(`  - Notes: ${s.estimate.notes.join("; ")}`);
  return lines.join("\n");
}

function productSection(product: Product, sites: Site[], intro: string): string {
  const mine = sites.filter((s) => productOf(s.primary) === product);
  if (mine.length === 0) return "";
  const groups = NACE_TYPES.filter((t) => productOf(t) === product)
    .map((t) => {
      const inType = mine.filter((s) => s.primary === t);
      return inType.length ? `### ${TYPE_LABELS[t]}\n\n${inType.map(siteLines).join("\n")}\n` : "";
    })
    .filter(Boolean);
  return `## ${product === "drex" ? "Drex" : "NDI"} sites\n\n${intro}\n\n${groups.join("\n")}`;
}

function architectureSection(a?: ArchitectureOverview): string {
  if (!a) return "";
  const rows = a.patterns
    .map((p) => `| ${p.name} | ${p.provider} | ${p.files.map((f) => `\`${f}\``).join(", ")} | ${p.purpose} |`)
    .join("\n");
  return `## Current AI architecture\n\n${a.description}\n\n| Usage pattern | Provider | Files | Purpose |\n|---|---|---|---|\n${rows}\n`;
}

function handlerCell(d: NonNullable<Finding["complexity"]["decomposition"]>[number]): string {
  if (d.handler === "drex") return `Drex \`${d.nace_type}\``;
  if (d.handler === "ndi") return `NDI \`${d.nace_type}\``;
  return "LLM";
}

function decompositionSection(findings: Finding[]): string {
  const complex = findings.filter((f) => f.complexity.score >= 3 && f.complexity.decomposition?.length);
  if (complex.length === 0) return "";
  const parts = complex.map((f) => {
    const rows = f.complexity.decomposition!.map((d) => `| ${d.step} | ${d.purpose} | ${handlerCell(d)} | ${d.notes} |`).join("\n");
    return `### ${f.process} (\`${location(f)}\`)\n\n${f.complexity.label} (${f.complexity.score}/5): ${f.complexity.reasons.join("; ")}\n\n| Step | Purpose | Handler | Notes |\n|---|---|---|---|\n${rows}\n`;
  });
  return `## Split-up calls\n\nThese calls do several jobs in one prompt. Each step goes to the cheapest handler that can do it; the LLM keeps only generation.\n\n${parts.join("\n")}`;
}

const API_REFERENCE = `## nace API reference

**Base URL:** \`https://console.nace.ai\`
**Auth:** \`Authorization: Bearer $NACE_API_KEY\` (one \`nace_sk_\` key covers Drex and NDI)
**Docs:** https://drex.nace.ai/docs

### Drex: \`POST /v1/systemone\`

\`\`\`json
{
  "model": "${DREX_MODEL}",
  "state": "<text or any JSON>",
  "questions": {
    "category": { "type": "choice", "instructions": "Which team should handle this?", "criteria": { "billing": "Payments and invoices", "technical": "Bugs and errors" } },
    "is_spam": { "type": "noul", "instructions": "Is this unsolicited advertising?" },
    "urgency": { "type": "score", "instructions": "How urgent is it?", "criteria": ["low", "medium", "high"] }
  }
}
\`\`\`

\`answers.<id>\` holds \`choice\` with \`probabilities\`, \`noul\` (the probability of yes), or \`score\` with \`probabilities\`. Billing is on \`usage.input_tokens\`.

### NDI: \`POST /v1/documents/{parse|split|classify|extract|ground}\`

Each call creates a job for one file. \`source\` is an https URL, a file uploaded to your workspace, or an earlier parse. Pass \`wait_seconds\` (up to 60) or poll \`GET /v1/documents/jobs/{id}\`. The SDKs handle uploads and waiting; see the templates.
`;

const SETUP = `## Setup

\`\`\`bash
pip install nace-sdk        # Python 3.11+
npm install nace-sdk        # Node
export NACE_API_KEY="nace_sk_..."
\`\`\`

Create a key at https://drex.nace.ai. One key covers Drex and NDI.
`;

export function generateMigrationPlanMarkdown(findings: Finding[], opts: ReportOptions = {}): string {
  const project = opts.projectName ?? "your project";
  const generated = (opts.now ?? new Date()).toISOString();
  const footer = `---\n*Generated by nace-migration-agent at ${generated} · report v1*\n`;
  if (findings.length === 0) {
    return `# nace Migration Plan — ${project}\n\nNo AI or document-processing calls were found.\n\n${footer}`;
  }

  const ndiPrice = opts.ndiUsdPerCredit ?? null;
  const sites: Site[] = findings
    .filter((f) => f.opportunities.length > 0)
    .map((f) => ({ finding: f, primary: f.opportunities[0].type, estimate: f.cost ? estimateCost(f.cost, ndiPrice) : null }));
  const kept = findings.filter((f) => f.opportunities.length === 0);
  const count = (p: Product) => sites.filter((s) => productOf(s.primary) === p).length;

  const full = sites.filter((s) => s.estimate && s.estimate.before_usd !== null && s.estimate.after_usd !== null);
  const totalBefore = full.reduce((n, s) => n + s.estimate!.before_usd!, 0);
  const unpricedCredits = full.reduce((n, s) => n + (s.estimate!.ndi_priced ? 0 : s.estimate!.ndi_credits), 0);
  const totalAfter = { after_usd: full.reduce((n, s) => n + s.estimate!.after_usd!, 0), ndi_credits: unpricedCredits, ndi_priced: unpricedCredits === 0 };
  const missing = sites.length - full.length;

  const header = `# nace Migration Plan — ${project}

> Generated: ${generated}
> Report version: 1
> Cost figures are estimates from token and page counts, not measurements. Prices as of ${PRICES_AS_OF}.
`;

  const summary = `## Summary

| Metric | Value |
|---|---|
| Files scanned | ${opts.filesScanned ?? 0} |
| Files with AI or document calls | ${new Set(findings.map((f) => f.file_path)).size} |
| Sites that can move to Drex | ${count("drex")} |
| Sites that can move to NDI | ${count("ndi")} |
| Calls that stay on the LLM | ${kept.length} |
| Estimated cost of 1,000 runs of each estimated site, today | ${formatUsd(totalBefore * 1000)} |
| Same, with nace | ${newPath(totalAfter, 1000)} |
${missing > 0 ? `| Sites without a full estimate | ${missing} |\n` : ""}`;

  const drexIntro = `Drex answers typed questions about text with calibrated probabilities. \`${DREX_MODEL}\` costs $${DREX_USD_PER_M_INPUT} per million input tokens; output is free.`;
  const ndiIntro =
    "NDI reads files and bills credits per page: parse 1, split 1, classify 2, extract 3, ground 5 per target." +
    (ndiPrice !== null
      ? ` Priced at ${formatUsd(ndiPrice)} per credit.`
      : " The price per credit is not set, so NDI costs are shown in credits; set NACE_NDI_USD_PER_CREDIT to see dollars.");

  const keptSection = kept.length
    ? `## Stays on the LLM\n\n${kept.map((f) => `- **${f.process}** (\`${location(f)}\`): ${f.keep_reason}`).join("\n")}\n`
    : "";

  return [
    header,
    summary,
    architectureSection(opts.architecture),
    productSection("drex", sites, drexIntro),
    productSection("ndi", sites, ndiIntro),
    keptSection,
    decompositionSection(findings),
    API_REFERENCE,
    SETUP,
    footer,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/schema.test.ts tests/analyzer.test.ts`
Expected: PASS. If a cost line differs only by float formatting, recompute it by hand from Task 2's prices before changing the expectation.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/tools/analyzer.ts tests/fixtures/findings.ts tests/schema.test.ts tests/analyzer.test.ts
git commit -m "Add the finding schema and the nace report with cost estimates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the MCP server

**Files:**
- Create: `src/config.ts`
- Rewrite: `src/index.ts`
- Test: `tests/config.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-5.
- Produces: `resolveNdiPrice(arg?: number | null, env?: string): number | null`; the MCP server `nace-migration-agent` with tools `get_ai_detection_patterns`, `get_integration_template`, `generate_migration_plan`, `save_migration_report` (writes `<project_root>/nace-report.md`).

- [ ] **Step 1: Write the failing tests**

`tests/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveNdiPrice } from "../src/config.js";

describe("resolveNdiPrice", () => {
  it("prefers the argument", () => {
    expect(resolveNdiPrice(0.02, "0.5")).toBe(0.02);
  });
  it("reads the environment", () => {
    expect(resolveNdiPrice(undefined, "0.005")).toBe(0.005);
  });
  it.each(["", "  ", "abc", "0", "-1", "Infinity"])("treats %j as unset", (env) => {
    expect(resolveNdiPrice(undefined, env)).toBeNull();
  });
  it("ignores a non-positive argument", () => {
    expect(resolveNdiPrice(0, undefined)).toBeNull();
  });
});
```

`tests/server.test.ts`:

```ts
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
    const env = { ...(process.env as Record<string, string>), NACE_NDI_USD_PER_CREDIT: "" };
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/config.test.ts tests/server.test.ts`
Expected: FAIL, cannot resolve `../src/config.js`; the server suite fails because `src/index.ts` imports removed names.

- [ ] **Step 3: Write `src/config.ts`**

```ts
/** USD per NDI credit: the tool argument wins, then NACE_NDI_USD_PER_CREDIT. Anything that is not a positive number counts as unset. */
export function resolveNdiPrice(arg?: number | null, env: string | undefined = process.env.NACE_NDI_USD_PER_CREDIT): number | null {
  if (typeof arg === "number" && Number.isFinite(arg) && arg > 0) return arg;
  if (env === undefined || env.trim() === "") return null;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : null;
}
```

- [ ] **Step 4: Rewrite `src/index.ts`**

(No shebang line: Task 8's bundler adds it.)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join } from "path";
import { z } from "zod";
import { resolveNdiPrice } from "./config.js";
import { architectureOverviewSchema, findingSchema, naceTypeSchema } from "./schema.js";
import { generateMigrationPlanMarkdown } from "./tools/analyzer.js";
import { LLM_FILE_INPUT_PATTERNS, PYTHON_EXTENSIONS, TS_JS_EXTENSIONS, getDetectionPatterns } from "./tools/patterns.js";
import { getBestTemplate } from "./tools/templates.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const server = new McpServer({ name: "nace-migration-agent", version });

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

// ── Tool 1: get_ai_detection_patterns ────────────────────────────────────────

server.tool(
  "get_ai_detection_patterns",
  `Returns grep -E compatible patterns for finding LLM calls and document-processing calls
(PDF libraries, OCR, document parsers, cloud OCR, LLM endpoints called without an SDK).
Each provider entry has kind ("llm" or "document"), import_patterns (decide whether a file uses
the provider), call_patterns (locate the call lines; generic names only count when the file also
uses the provider) and strong_call_patterns (distinctive enough to count alone).
llm_file_input_patterns mark LLM calls that send a file or image. See usage_guide.rules.`,
  {
    language: z
      .enum(["python", "typescript", "javascript", "all"])
      .optional()
      .describe("Filter by language. Omit or pass 'all' for every language."),
  },
  async ({ language }) =>
    json({
      patterns: getDetectionPatterns(language === "all" || language === undefined ? undefined : language),
      llm_file_input_patterns: LLM_FILE_INPUT_PATTERNS,
      usage_guide: {
        bash_example: "grep -rnE --include='*.py' 'chat\\.completions\\.create' ./src",
        note: "All patterns are grep -E (extended regex) compatible.",
        rules: [
          "Only search files with the entry's `extensions`, skipping `exclude_dirs`.",
          "A file uses a provider if any of its import_patterns match, or any of its strong_call_patterns match.",
          "In a file that uses the provider, call_patterns give the line numbers of the calls.",
          "A call_patterns match in a file that does not use the provider is not a call (e.g. Twilio's messages.create, a project's own generateText).",
          "kind tells whether a provider is an LLM or a document pipeline; report the two groups separately.",
          "In a file that uses an LLM provider, a llm_file_input_patterns match means a call sends a file or image: a candidate for NDI. Ignore these matches in files without an LLM provider.",
          "A client can be created in one file and used in another; tracing must follow it back to where it is constructed.",
        ],
        file_extensions: { python: PYTHON_EXTENSIONS, typescript_javascript: TS_JS_EXTENSIONS },
        exclude_dirs: ["node_modules", ".venv", "venv", "__pycache__", ".git", "dist", "build"],
      },
    }),
);

// ── Tool 2: get_integration_template ─────────────────────────────────────────

server.tool(
  "get_integration_template",
  `Returns a before/after code template for moving one call to nace with nace-sdk.
Types: drex_choice, drex_noul, drex_score (decisions about text) and
ndi_parse, ndi_split, ndi_classify, ndi_extract, ndi_ground (work on files).
Providers with their own before_snippet: openai and anthropic (python, typescript), vercel_ai (typescript),
plus pdf_text and local_ocr for ndi_parse. Any other provider gets the closest template with
exact_match: false; its after_snippet still applies.`,
  {
    opportunity_type: naceTypeSchema.describe("The nace type to apply."),
    provider: z.string().describe("Provider of the original call, e.g. 'openai', 'anthropic', 'vercel_ai', 'pdf_text'."),
    language: z.enum(["python", "typescript"]).describe("Programming language."),
  },
  async ({ opportunity_type, provider, language }) => {
    const match = getBestTemplate(opportunity_type, provider, language);
    if (!match) return json({ found: false, message: `No template for ${opportunity_type}. See https://drex.nace.ai/docs.` });
    const { template, exact_match } = match;
    const notes: string[] = [];
    if (template.provider !== provider.toLowerCase()) {
      notes.push(
        `No ${provider} template exists; before_snippet shows ${template.provider}. The after_snippet (the nace call) is the same for every provider; adapt the surrounding code to ${provider}.`,
      );
    }
    if (template.language !== language) notes.push(`No ${language} template exists; this one is ${template.language}.`);
    return json({
      found: true,
      exact_match,
      matched_provider: template.provider,
      matched_language: template.language,
      ...(notes.length ? { match_note: notes.join(" ") } : {}),
      ...template,
    });
  },
);

// ── Tool 3: generate_migration_plan ──────────────────────────────────────────

server.tool(
  "generate_migration_plan",
  `Builds the nace-report.md markdown from the findings: summary with estimated cost before and
after, architecture overview, Drex sites, NDI sites, calls that stay on the LLM, split-up calls,
API reference and setup. Cost arithmetic happens here, from each finding's cost block and the
built-in price list. NDI dollars need ndi_usd_per_credit or the NACE_NDI_USD_PER_CREDIT environment
variable; otherwise NDI is shown in credits. Call save_migration_report next.`,
  {
    findings: z.array(findingSchema).describe("One finding per call site, including calls that stay on the LLM."),
    project_name: z.string().optional().describe("Name of the project (used in the heading)."),
    files_scanned: z.number().int().nonnegative().optional().describe("Number of files scanned."),
    architecture_overview: architectureOverviewSchema.optional(),
    ndi_usd_per_credit: z.number().positive().optional().describe("USD per NDI credit. Overrides NACE_NDI_USD_PER_CREDIT."),
  },
  async ({ findings, project_name, files_scanned, architecture_overview, ndi_usd_per_credit }) => ({
    content: [
      {
        type: "text" as const,
        text: generateMigrationPlanMarkdown(findings, {
          projectName: project_name,
          filesScanned: files_scanned ?? 0,
          architecture: architecture_overview,
          ndiUsdPerCredit: resolveNdiPrice(ndi_usd_per_credit),
        }),
      },
    ],
  }),
);

// ── Tool 4: save_migration_report ────────────────────────────────────────────

/**
 * Returns an absolute project root, or undefined if the path is relative/empty.
 * On Windows, converts a Git Bash path (`/c/Users/...`).
 */
function normalizeProjectRoot(projectRoot: string): string | undefined {
  let p = projectRoot.trim();
  if (process.platform === "win32") {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
    if (m) p = `${m[1].toUpperCase()}:${(m[2] ?? "/").replace(/\//g, "\\")}`;
  }
  return p && isAbsolute(p) ? p : undefined;
}

server.tool(
  "save_migration_report",
  `Saves the report markdown to <project_root>/nace-report.md. Always call this after
generate_migration_plan. Returns the absolute path of the saved file.`,
  {
    markdown: z.string().describe("The markdown returned by generate_migration_plan."),
    project_root: z.string().describe("Absolute path to the root of the project being evaluated."),
  },
  async ({ markdown, project_root }) => {
    const root = normalizeProjectRoot(project_root);
    if (!root) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              saved: false,
              error: `project_root must be an absolute path (got ${JSON.stringify(project_root)}). A relative path would resolve against the MCP server's working directory, not the project.`,
            }),
          },
        ],
      };
    }
    const outPath = join(root, "nace-report.md");
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, markdown, "utf8");
      return json({ saved: true, path: outPath });
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ saved: false, error: String(err), path: outPath }) }] };
    }
  },
);

// ── Start ────────────────────────────────────────────────────────────────────

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("nace migration agent failed to start:", err);
  process.exit(1);
});
```

- [ ] **Step 5: Run all tests and the typecheck**

```bash
npm test && npm run typecheck
```

Expected: every suite passes; typecheck passes. If `tsc` reports `naceTypeSchema` as `unknown` inside the tool handler, cast in the handler: `getBestTemplate(opportunity_type as NaceType, provider, language)` with `import type { NaceType } from "./tools/types.js"`.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/index.ts tests/config.test.ts tests/server.test.ts
git commit -m "Wire the MCP server to the nace patterns, templates and report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The evaluate skill, plugin manifests and README

**Files:**
- Rewrite: `skills/evaluate/SKILL.md`, `.agents/skills/evaluate/SKILL.md` (identical copy), `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.mcp.json`, `README.md`
- Test: `tests/plugin.test.ts`

**Interfaces:**
- Consumes: the four tool names from Task 6; `NACE_TYPES`.
- Produces: plugin `nace-migrate`, marketplace `nace`, skill `evaluate` → command `/nace-migrate:evaluate`.

- [ ] **Step 1: Write the failing test**

`tests/plugin.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run tests/plugin.test.ts`
Expected: FAIL, `expected 'slm-agent' to be 'nace-migrate'`.

- [ ] **Step 3: Write the manifests**

`.claude-plugin/plugin.json`:

```json
{
  "name": "nace-migrate",
  "displayName": "nace Migration Agent",
  "version": "0.1.0",
  "description": "Scans your codebase for LLM and document-processing calls, shows which can move to nace's Drex (decisions) and NDI (documents) with a cost estimate, and migrates them on approval. The scan runs locally; no code is sent to nace.",
  "author": { "name": "nace.ai", "email": "saruar@nace.ai" },
  "homepage": "https://drex.nace.ai",
  "repository": "https://github.com/saruar-dev/nace-migration-agent",
  "license": "MIT",
  "keywords": ["nace", "drex", "ndi", "migration", "cost-reduction", "openai", "anthropic"],
  "category": "productivity"
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://code.claude.com/schemas/marketplace.json",
  "name": "nace",
  "displayName": "nace",
  "description": "nace plugins for Claude Code: move LLM and document-processing calls to Drex and NDI.",
  "owner": { "name": "nace.ai", "email": "saruar@nace.ai" },
  "homepage": "https://drex.nace.ai",
  "plugins": [
    {
      "name": "nace-migrate",
      "displayName": "nace Migration Agent",
      "source": { "source": "url", "url": "https://github.com/saruar-dev/nace-migration-agent.git", "ref": "nace" },
      "skills": ["./skills/evaluate"],
      "description": "Finds the LLM and document-processing calls that can move to Drex and NDI, estimates the cost before and after, and migrates them on approval.",
      "version": "0.1.0",
      "author": { "name": "nace.ai", "email": "saruar@nace.ai" },
      "homepage": "https://drex.nace.ai",
      "repository": "https://github.com/saruar-dev/nace-migration-agent",
      "license": "MIT",
      "keywords": ["nace", "drex", "ndi", "migration", "cost-reduction"],
      "category": "productivity"
    }
  ]
}
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "nace-migration-agent": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": { "NACE_NDI_USD_PER_CREDIT": "${NACE_NDI_USD_PER_CREDIT:-}" }
    }
  }
}
```

- [ ] **Step 4: Write `skills/evaluate/SKILL.md`**

````markdown
---
name: evaluate
description: >
  Evaluate the current codebase for nace integration opportunities. Finds every
  LLM call and document-processing call (PDF text extraction, OCR, cloud OCR,
  files sent to vision models), traces what each one does across files, sorts
  it to Drex (typed decisions), NDI (document parse, split, classify, extract,
  ground) or "stays on the LLM", estimates the cost before and after, writes
  nace-report.md, and migrates approved sites with nace-sdk.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Glob
  - Grep
  # Tool names when installed as the Claude Code plugin
  - mcp__plugin_nace-migrate_nace-migration-agent__get_ai_detection_patterns
  - mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template
  - mcp__plugin_nace-migrate_nace-migration-agent__generate_migration_plan
  - mcp__plugin_nace-migrate_nace-migration-agent__save_migration_report
  # Tool names when the MCP server is added by hand as "nace-migration-agent"
  - mcp__nace-migration-agent__get_ai_detection_patterns
  - mcp__nace-migration-agent__get_integration_template
  - mcp__nace-migration-agent__generate_migration_plan
  - mcp__nace-migration-agent__save_migration_report
---

You are the nace migration specialist. Find every place in this codebase that
pays an LLM or an OCR provider for work nace does cheaper or better:

- **Drex** (`POST /v1/systemone`): typed decisions about text, with calibrated
  probabilities. `drex_choice` picks one label from a fixed set, `drex_noul`
  gives the probability of yes, `drex_score` places the input on an ordered
  rubric. `drex-v2.0` costs $0.06 per million input tokens; output is free.
- **NDI** (`POST /v1/documents/{tool}`): work on files. `ndi_parse` turns a
  file into text, `ndi_split` cuts a packet into documents, `ndi_classify`
  labels a document or page, `ndi_extract` fills a schema with citations,
  `ndi_ground` finds where a value appears. Billed in credits per page.

Both use one `NACE_API_KEY` and the `nace-sdk` package (Python and TypeScript).
The scan is local: you read files; nothing is sent to nace.

Work through the phases in order. Do not skip ahead.

---

## Phase 1 — Discovery

1. Call `get_ai_detection_patterns` with no arguments.
2. Glob candidate files: every extension in `usage_guide.file_extensions`,
   excluding `usage_guide.exclude_dirs`. Also skip tests, fixtures, examples,
   notebooks, vendored and generated code, and archived folders (`archive/`,
   `__CLEANUP__/`, `deprecated/`).
3. For each provider entry, grep its patterns over files with its `extensions`,
   following `usage_guide.rules`:
   - A file uses the provider if an `import_patterns` or a
     `strong_call_patterns` entry matches.
   - In those files, `call_patterns` give the call lines.
   - Ignore `call_patterns` matches in files that do not use the provider.
4. In files that use an LLM provider (`kind: "llm"`), grep
   `llm_file_input_patterns`. A match means a call sends a file or image to the
   model: a candidate for NDI.
5. Deduplicate by file. Tell the user how many files use LLM providers and how
   many use document providers, which providers, and the file list.

---

## Phase 2 — Tracing (mandatory)

The line nearest a call rarely says what it is for. Trace each one.

1. **Call site.** Read ±30 lines around each match: the enclosing function and
   the variables for the prompt, the file and the result.
2. **Prompt.** If the prompt or messages are built elsewhere, grep for the
   variables and read where they are built, including template files, until
   you have seen the text that goes to the model.
3. **Callers.** Grep for the enclosing function and read each caller. A shared
   helper such as `call_llm()` with callers of different purposes is one
   finding per distinct caller. Follow injected clients back to where they are
   constructed.
4. **Model.** Find the model id the call uses. Resolve configuration: for
   `model=settings.openai_model`, read the settings default. Write `"unknown"`
   if it cannot be resolved; never guess.
5. **Record** for each call:

   ```
   file: <path>  line: <call line>
     enclosing_function: <name>
     process: <short name, e.g. "Ticket category">
     purpose: <what the call does>
     input_kind: <file | text>   (file = PDF, image, office document, or bytes read from one)
     output_used_for: <what the code does with the result>
     provider: <openai | anthropic | vercel_ai | pdf_text | local_ocr | cloud_ocr | raw_http_llm | ...>
     model: <resolved model id, or "unknown">
     input_tokens: <estimate per call: fixed prompt text at ~4 characters per token, plus a stated assumption for the variable part>
     output_tokens: <estimate per call: the size of the expected answer, or max_tokens for long-form output>
     pages: <for file inputs: pages per document, as a stated assumption>
   ```

6. **Architecture overview.** Write one paragraph on how and where AI and
   document processing are used, then list each usage pattern (name, files,
   provider, purpose). This becomes `architecture_overview`.

---

## Phase 3 — Sorting

### What goes where

| The code... | Type |
|---|---|
| branches on one label from a fixed set (route, intent, category) | `drex_choice` |
| branches on yes/no (spam, safety, policy violation, groundedness) | `drex_noul` |
| uses an ordered level or a numeric rating (urgency, quality, an LLM judge's score, reranking) | `drex_score`; `drex_choice` when only the top candidate is used |
| keeps a subset of candidates | one `drex_noul` per candidate, sent as several questions in one request |
| turns a PDF, scan, image, DOCX or XLSX into text (PDF library, OCR, cloud OCR, a "transcribe" prompt to a vision model) | `ndi_parse` |
| fills fields or a schema from a file (vision LLM, Textract AnalyzeExpense, Azure prebuilt models) | `ndi_extract` |
| decides the type of a file or page | `ndi_classify` |
| cuts a multi-document file into documents | `ndi_split` |
| finds where a value or quote appears in a file | `ndi_ground` |
| generates text, chats, summarizes, writes code, embeds, or plans tool calls with generated arguments | stays on the LLM |

### Boundary rules

1. **File or text.** If the input is a file, the site is NDI. If the input is
   text already in memory, it is Drex. "What type is this PDF" is
   `ndi_classify`; "what kind of request is this email" is `drex_choice`.
2. **Extraction from short text** (a chat message, a ticket body) stays on the
   LLM. Exception: picking one of several candidates the code already has is
   `drex_choice`.
3. **A flag returned with generated or extracted output** belongs to that
   output. The call is a site for the flag only when the flag is the main thing
   the code acts on.
4. **One call, several jobs.** Write a decomposition (below).
5. **Shared helpers.** One finding per distinct caller purpose.
6. **Dead code** (no production caller) is not reported.
7. **Privacy steps.** If the code masks or redacts the input before the model,
   say so in the reason: NDI receives the original file.

### Confidence

- **high**: you read the prompt and the call clearly does one job above.
- **medium**: strong signals, but the prompt is partly dynamic or the callers
  are ambiguous.
- **low**: it might fit, but you cannot confirm without runtime data.

### Complexity and decomposition

| Score | Label | When |
|---|---|---|
| 1 | trivial | One job, simple input |
| 2 | simple | One job with some dynamic context |
| 3 | moderate | Two jobs in one prompt, or large dynamic context |
| 4 | complex | Three or more jobs, or generation mixed with extraction |
| 5 | highly_complex | Chained reasoning, few-shot, or open-ended generation with structured output |

For score 3 or more with several jobs, write `complexity.decomposition`: ordered
steps, each with `handler` `drex`, `ndi` or `llm`. Drex and NDI steps need
`nace_type` of their own product. Keep `llm` only for generation and open
reasoning.

### Cost block

Every site gets a `cost` block. Calls that stay on the LLM do not.

- `before`, what the call costs today:
  - LLM call: `{ "kind": "llm", "model": "<id>", "input_tokens": N, "output_tokens": N }`
  - cloud OCR: `{ "kind": "ocr_service", "service": "<key>", "pages": N }`. Keys:
    `textract:detect_document_text`, `textract:analyze_document_forms`,
    `textract:analyze_document_tables`, `textract:analyze_document_queries`,
    `textract:analyze_document_forms_tables_queries`, `textract:analyze_expense`,
    `textract:analyze_id`; for others write `azure:<model>` or
    `google_docai:<processor>` (reported as not estimated).
  - local library (pypdf, pdf-parse, tesseract): `{ "kind": "local", "library": "<name>" }`
- `after`, one entry per step of the new path:
  - Drex: `{ "handler": "drex", "input_tokens": N }`: the state plus the
    question text. Usually smaller than the old prompt, because instructions,
    examples and output-format text go away.
  - NDI: `{ "handler": "ndi", "tool": "<parse|split|classify|extract|ground>", "pages": N }`,
    plus `targets` for ground, and `parse_mode: "high"` only if the old code did
    OCR correction.
  - Steps that stay on the LLM: `{ "handler": "llm", "model": "<id>", "input_tokens": N, "output_tokens": N }`
- `assumptions`: every number you estimated, in words ("ticket body ≈ 150
  tokens", "invoices are 2 pages").

### Findings

One finding per call site, including calls that stay on the LLM:

```json
{
  "file_path": "src/services/classifier.py",
  "line_number": 280,
  "provider": "openai",
  "process": "Ticket category",
  "opportunities": [
    { "type": "drex_choice", "confidence": "high", "reason": "Picks one of 8 fixed categories; the router branches on it." }
  ],
  "complexity": { "score": 2, "label": "simple", "reasons": ["One label from a fixed set"] },
  "cost": {
    "before": { "kind": "llm", "model": "gpt-4o", "input_tokens": 900, "output_tokens": 150 },
    "after": [{ "handler": "drex", "input_tokens": 300 }],
    "assumptions": ["ticket body ≈ 150 tokens"]
  },
  "code_snippet": "<the 5-10 most relevant lines>"
}
```

A call that stays on the LLM has `"opportunities": []`, a `keep_reason`, and
no `cost`. Put the most confident opportunity first: the report files the site
under it.

---

## Phase 4 — Report

1. Run `pwd` to get the absolute project root.
2. Call `generate_migration_plan` with `findings`, `project_name` (the basename
   of the root), `files_scanned`, and `architecture_overview`. Pass
   `ndi_usd_per_credit` only if the user gave you a price per credit.
3. Immediately call `save_migration_report` with the exact markdown and the
   absolute root. Do this before printing anything.
4. Tell the user: "Report saved to `nace-report.md`." Then summarize: files
   scanned, files with calls, sites for Drex, sites for NDI, calls that stay on
   the LLM, the estimated cost before and after, and the quick wins (file and
   one-line reason).

---

## Phase 5 — Decomposition review

For each finding with a decomposition, write one short paragraph, with no
tables or code blocks: which steps become Drex or NDI calls and which step, if
any, stays on the LLM. For example: "src/intake.py line 88 sends the invoice
PDF to GPT-4o to pull fields, decide approve or reject, and draft an email.
Split it into NDI `ndi_extract` for the fields, a Drex `drex_noul` for the
approval, and keep only the email on the LLM."

---

## Phase 6 — Migration (only if the user approves)

Ask:

> "Would you like me to apply these changes?
> - **yes**: apply all
> - **no**: stop here; the report is saved as `nace-report.md`
> - **select**: approve each change one by one"

Do not edit any file until the user says yes or select. For each approved site:

1. Call `get_integration_template` with the site's first opportunity type, the
   provider and the language.
2. Read the whole file.
3. Apply the change:
   - Replace the call with the template's nace-sdk code, using the file's real
     variable names, never the template's placeholders.
   - Keep the old labels and output shape so callers do not change: Drex
     `choice` criteria keys are the old labels; NDI extract schemas list the
     old fields.
   - Add the setup (import and client) once per module.
   - For a decomposed call, replace it with the ordered steps, keeping any LLM
     step last.
   - Let Drex or NDI errors raise. Do not add a silent fallback to the old
     provider.
4. Confirm: "Updated `<file_path>`".

After the edits, remind the user to install `nace-sdk` and set `NACE_API_KEY`
(create a key at https://drex.nace.ai; one key covers Drex and NDI).

---

## Rules

- Never edit files without explicit approval.
- Never skip Phase 2.
- Never guess a model id or a price: write "unknown" and let the report say
  "not estimated".
- Always save the report, whether or not the user approves migration.
````

Copy it: `cp skills/evaluate/SKILL.md .agents/skills/evaluate/SKILL.md`

- [ ] **Step 5: Rewrite `README.md`**

````markdown
# nace Migration Agent

A Claude Code plugin and MCP server that scans your codebase for LLM calls and
document-processing calls, shows which ones can move to nace, estimates the
cost before and after, and migrates them with your approval.

- **Drex** for decisions about text: pick a label (`drex_choice`), answer yes or
  no (`drex_noul`), rate on a scale (`drex_score`), with calibrated
  probabilities. `drex-v2.0` is $0.06 per million input tokens; output is free.
- **NDI** for files: parse, split, classify, extract (with citations) and
  ground, billed in credits per page.

> **Privacy:** the scan runs locally. The MCP server makes no network calls and
> no code is sent to nace. Your coding agent reads the code with its own model.
> nace is only called when your migrated code runs.

## Install

From a local clone:

```bash
claude --plugin-dir ~/nace-migration-agent
```

From GitHub:

```
/plugin marketplace add saruar-dev/nace-migration-agent
/plugin install nace-migrate@nace
/reload-plugins
```

Then, in any project:

```
/nace-migrate:evaluate
```

## The report

`nace-report.md` in the project root has:

- a summary: files scanned, sites for Drex, sites for NDI, calls that stay on the
  LLM, and the estimated cost of 1,000 runs of each site today and with nace;
- the architecture overview;
- every Drex and NDI site with its location, confidence, reason and cost line;
- the calls that stay on the LLM, and why;
- split-up plans for calls that do several jobs;
- the nace API reference and setup.

Costs are estimates from token and page counts and a dated price list
(`src/tools/pricing.ts`). A model that is not on the list is reported as "not
estimated". NDI is shown in credits unless you set a price per credit:

```bash
export NACE_NDI_USD_PER_CREDIT=0.01   # your price, from the console's Models & pricing page
```

## MCP tools

| Tool | What it does |
|---|---|
| `get_ai_detection_patterns` | grep patterns for LLM providers, raw HTTP LLM calls and document pipelines |
| `get_integration_template` | before/after code with `nace-sdk` for each of the eight types |
| `generate_migration_plan` | builds the report and does the cost arithmetic |
| `save_migration_report` | writes `nace-report.md` to the project root |

## Development

```bash
npm install
npm test             # unit and server tests
npm run typecheck
npm run bundle       # rebuilds dist/index.js; commit it with any src change
NACE_API_KEY=nace_sk_... npm run live-check   # runs every after_snippet against the live API
```

## Credits

Forked from [scaledown-team/SLM_Agent](https://github.com/scaledown-team/SLM_Agent)
(MIT). See `LICENSE`.
````

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS, including `tests/plugin.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add skills .agents .claude-plugin .mcp.json README.md tests/plugin.test.ts
git commit -m "Rewrite the evaluate skill, plugin manifests and README for nace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Bundle the server into one committed file

**Files:**
- Create: `scripts/bundle.mjs`, `dist/index.js` (generated, committed)
- Test: `tests/server.test.ts` (already runs against `dist/index.js` when it exists)

**Interfaces:**
- Consumes: `src/index.ts`.
- Produces: `dist/index.js`, runnable as `node dist/index.js` with no `node_modules`.

- [ ] **Step 1: Write `scripts/bundle.mjs`**

```js
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  logLevel: "info",
});
```

- [ ] **Step 2: Build and confirm the server test now covers the bundle**

```bash
npm run bundle
npx vitest run tests/server.test.ts
```

Expected: two suites, `MCP server (source)` and `MCP server (bundle)`, both pass.

- [ ] **Step 3: Prove the bundle needs no node_modules**

```bash
D=$(mktemp -d) && mkdir -p "$D/dist" && cp dist/index.js "$D/dist/" && cp package.json "$D/"
node -e '
const { spawn } = require("node:child_process");
const dir = process.argv[1];
const p = spawn(process.execPath, ["dist/index.js"], { cwd: dir });
const timer = setTimeout(() => { console.error("no response"); p.kill(); process.exit(1); }, 5000);
p.stdout.on("data", (d) => { console.log(String(d).slice(0, 300)); clearTimeout(timer); p.kill(); });
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }) + "\n");
' "$D"
```

Expected: a JSON-RPC response containing `"name":"nace-migration-agent"`, from a directory with no `node_modules`.

- [ ] **Step 4: Commit**

```bash
git add scripts/bundle.mjs dist/index.js
git commit -m "Bundle the MCP server into dist/index.js so the plugin installs from git

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Live check of every after_snippet

**Files:**
- Create: `scripts/make-sample-pdf.mjs`, `tests/fixtures/sample-invoice.pdf` (generated, committed), `scripts/live-check.ts`
- Modify: `package.json` (devDependency `nace-sdk@0.1.0`)

**Interfaces:**
- Consumes: `SCENARIOS`, `programFor` (Task 4).
- Produces: `npm run live-check [type|language ...]`, exit code 0 when every selected snippet ran.

This task spends real credit: 6 Drex calls (fractions of a cent) and 2 × (1 + 1 + 2 + 3 + 5) = 24 NDI credits.

- [ ] **Step 1: Generate the sample PDF**

`scripts/make-sample-pdf.mjs`:

```js
import { writeFileSync } from "node:fs";

const lines = ["INVOICE", "Invoice number: INV-1042", "Invoice date: 2026-10-01", "Bill to: Acme Corp", "Total: 1,200.50 USD"];
const content = ["BT", "/F1 14 Tf", "72 720 Td", "20 TL", ...lines.map((l) => `(${l}) Tj T*`), "ET"].join("\n");
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];

let pdf = "%PDF-1.4\n";
const offsets = objects.map((body, i) => {
  const at = Buffer.byteLength(pdf);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync("tests/fixtures/sample-invoice.pdf", pdf, "latin1");
```

```bash
node scripts/make-sample-pdf.mjs
mdls -raw -name kMDItemNumberOfPages tests/fixtures/sample-invoice.pdf   # expect 1
python3 -c "import subprocess;print(subprocess.run(['strings','tests/fixtures/sample-invoice.pdf'],capture_output=True,text=True).stdout)" | grep INV-1042
```

Expected: `1`, then a line containing `INV-1042`. Open it once with `open tests/fixtures/sample-invoice.pdf` and confirm five lines of text render.

- [ ] **Step 2: Install the SDK and write the harness**

```bash
npm install --save-dev --save-exact nace-sdk@0.1.0
```

`scripts/live-check.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { SCENARIOS, programFor } from "../src/tools/snippets.js";
import type { Language } from "../src/tools/types.js";

const DIR = ".live-check";
const key = process.env.NACE_API_KEY || process.env.DREX_API_KEY;
if (!key) {
  console.error("Set NACE_API_KEY (a nace_sk_ key) before running the live check.");
  process.exit(2);
}
const env = { ...process.env, NACE_API_KEY: key };

mkdirSync(DIR, { recursive: true });
const venvPython = `${DIR}/venv/bin/python`;
if (!existsSync(venvPython)) {
  for (const [cmd, args] of [
    ["python3", ["-m", "venv", `${DIR}/venv`]],
    [venvPython, ["-m", "pip", "install", "--quiet", "nace-sdk==0.1.0"]],
  ] as const) {
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const filters = process.argv.slice(2);
let failed = 0;
for (const s of SCENARIOS) {
  for (const language of ["python", "typescript"] as Language[]) {
    if (filters.length && !filters.includes(s.type) && !filters.includes(language)) continue;
    const file = `${DIR}/${s.type}.${language === "python" ? "py" : "ts"}`;
    writeFileSync(file, programFor(s, language));
    const r =
      language === "python"
        ? spawnSync(venvPython, [file], { encoding: "utf8", env, timeout: 180_000 })
        : spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", file], { encoding: "utf8", env, timeout: 180_000 });
    const ok = r.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${s.type.padEnd(13)} ${language.padEnd(10)} ${(ok ? r.stdout : r.stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
  }
}
process.exit(failed ? 1 : 0);
```

- [ ] **Step 3: Run the Drex checks first**

```bash
export NACE_API_KEY=$(grep '^DREX_API_KEY=' ~/Desktop/pay-app-certification/.env | cut -d= -f2- | tr -d "\"' ")
npm run live-check -- drex_choice drex_noul drex_score
```

Expected, 6 PASS lines: `drex_choice` prints `billing` and a confidence; `drex_noul` a probability above 0.5 and `True`/`true`; `drex_score` a level of 2 or 3. If a snippet fails because the SDK's field or method name differs from the docs, fix the snippet in `src/tools/snippets.ts`, rerun `npx vitest run tests/templates.test.ts`, and rerun this step.

- [ ] **Step 4: Run the NDI checks**

```bash
npm run live-check -- ndi_parse ndi_split ndi_classify ndi_extract ndi_ground
```

Expected, 10 PASS lines: parse prints text containing `INV-1042`; split prints one segment with type `invoice`; classify prints `invoice`; extract prints `invoice_number` `INV-1042` and `total` 1200.5; ground prints `found` (or the API's success status) and a location. If NDI answers `503 document_billing_not_configured`, stop and report it to Saruar: document billing is not enabled for the account. Fix any SDK mismatch in the snippet as in Step 3.

- [ ] **Step 5: Commit**

```bash
git add scripts/make-sample-pdf.mjs scripts/live-check.ts tests/fixtures/sample-invoice.pdf package.json package-lock.json src/tools/snippets.ts
npm run bundle && git add dist/index.js
git commit -m "Add a live check that runs every nace-sdk snippet against the API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Answer keys for the two test repos

**Files:**
- Create: `docs/examples/answer-keys/supportiq.md`, `docs/examples/answer-keys/opp-agent.md`

**Interfaces:**
- Produces: the expected sites that Task 11 grades against.

Written before any run, from reading the code at the pinned commits. Clone into `.e2e/` (gitignored) and read only.

- [ ] **Step 1: Clone both repos at the pinned commits**

```bash
mkdir -p .e2e && cd .e2e
git clone -q https://github.com/meryemsakin/supportiq && git -C supportiq checkout -q 0438e7ebe694c22f4872a41ce1d7e0ba4681f715
git clone -q https://github.com/m-ahmedbashir/opp-agent && git -C opp-agent checkout -q ec1e7871cb7c66929c48f4614c7116fb583acf03
cd ..
```

- [ ] **Step 2: Verify each expected site still matches the code**

For every row below, open the function and confirm the call and the use of its result. Record each function's first and last line numbers in the key.

```bash
grep -n "async def _call_openai\|async def classify\b" .e2e/supportiq/src/services/classifier.py
grep -n "async def _analyze_with_openai" .e2e/supportiq/src/services/sentiment.py
grep -n "async def _generate_ai_response\|async def _get_embedding" .e2e/supportiq/src/services/rag.py
grep -n "openai_model" -A2 .e2e/supportiq/src/config.py
grep -n "sentiment" .e2e/supportiq/src/models/rule.py
grep -n "private async extractText\|private async classifyDocumentType\|private async callModel\|private async renderPdfPagesToImages" .e2e/opp-agent/apps/backend/src/modules/extraction/extraction.service.ts
grep -n "async recognizeText" .e2e/opp-agent/apps/backend/src/modules/extraction/ocr.service.ts
grep -n "export async function POST" .e2e/opp-agent/apps/frontend/src/app/api/chat/route.ts
grep -n "modelId" .e2e/opp-agent/apps/backend/src/modules/extraction/model-registry.ts
```

- [ ] **Step 3: Write `docs/examples/answer-keys/supportiq.md`**

```markdown
# Answer key: meryemsakin/supportiq @ 0438e7e

Written by hand before running the agent. A reported site matches a row when its
file matches and its line falls inside the row's function.

## Sites (must be reported, with this type)

| # | File | Function (lines) | Expected type | Why |
|---|---|---|---|---|
| S1 | src/services/classifier.py | TicketClassifier._call_openai (fill in) | drex_choice | Picks the primary category from 8 fixed categories; classify() validates it against the list. Secondary categories may appear as an Also line (drex_noul per category). |
| S2 | src/services/sentiment.py | SentimentAnalyzer._analyze_with_openai (fill in) | drex_choice | Returns positive/neutral/negative/angry; models/rule.py branches on the label. The numeric score can come from the choice probabilities. drex_score is accepted only if the reason addresses the label the rules use. |

## Stays on the LLM (must not be reported as a Drex or NDI site)

| # | File | Function | Why |
|---|---|---|---|
| K1 | src/services/rag.py | KnowledgeBase._generate_ai_response | Generates a suggested reply. Expected in "Stays on the LLM". |
| K2 | src/services/rag.py | KnowledgeBase._get_embedding | Embeddings. May be absent from the report or listed as staying on the LLM. |
| K3 | src/api/health.py | check_openai | models.list health check. May be absent or listed as staying on the LLM. |

## Not counted

Rule-based fallbacks in classifier.py and sentiment.py and the keyword rules in
services/priority_scorer.py: non-LLM heuristics, out of scope.

## Cost

Default model `gpt-4-turbo-preview` (src/config.py): priced as
gpt-4-turbo-2024-04-09 with a note. A report that says "not estimated" for it
fails the cost check.
```

Replace each `(fill in)` with the line range found in Step 2.

- [ ] **Step 4: Write `docs/examples/answer-keys/opp-agent.md`**

```markdown
# Answer key: m-ahmedbashir/opp-agent @ ec1e787

Written by hand before running the agent. A reported site matches a row when its
file matches and its line falls inside the row's function.

## Sites (must be reported, with this type)

| # | File | Function (lines) | Expected type | Why |
|---|---|---|---|---|
| O1 | apps/backend/src/modules/extraction/extraction.service.ts | extractText (fill in) | ndi_parse | pdf-parse getText on the uploaded PDF. Before cost: local, $0. |
| O2 | apps/backend/src/modules/extraction/ocr.service.ts | OcrService.recognizeText (fill in) | ndi_parse | tesseract.js OCR of page images. Before cost: local, $0. |
| O3 | apps/backend/src/modules/extraction/extraction.service.ts | classifyDocumentType (fill in) | ndi_classify or drex_choice | generateObject picks one document type. The input is PII-masked text and images from the uploaded file. Either type passes only if the reason mentions the masking. |
| O4 | apps/backend/src/modules/extraction/extraction.service.ts | callModel (fill in) | ndi_extract | generateObject fills the document type's schema from the file's text and images; the imagePiiDetected flag belongs to the extraction. |

## Stays on the LLM

| # | File | Function | Why |
|---|---|---|---|
| K1 | apps/frontend/src/app/api/chat/route.ts | POST | streamText chat. Expected in "Stays on the LLM". |

## Not counted

- renderPdfPagesToImages: a helper of the parse/vision path; may appear as an extra pointer, not as its own site.
- apps/frontend/__CLEANUP__/: archived code.
- Test files (*.spec.ts).

## Cost

Models in model-registry.ts: gpt-4o (priced), claude-3-5-sonnet-20241022 (not on
the price list: "not estimated"), Groq llama models (not estimated). A report that
prices claude-3-5-sonnet or a llama model fails the cost check.
```

Replace each `(fill in)` with the line range found in Step 2.

- [ ] **Step 5: Commit**

```bash
git add docs/examples/answer-keys
git commit -m "Add hand-written answer keys for the supportiq and opp-agent runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end runs with Claude Code

**Files:**
- Create: `docs/examples/supportiq-nace-report.md`, `docs/examples/opp-agent-nace-report.md`, `docs/examples/results.md`
- Modify (only if a run fails its key): `skills/evaluate/SKILL.md` + its `.agents` copy, `src/tools/patterns.ts`, then `dist/index.js`

**Interfaces:**
- Consumes: the plugin (Tasks 6-8), the answer keys (Task 10).
- Produces: two committed reports and a results table.

- [ ] **Step 1: Run the skill headless on supportiq**

```bash
cd ~/nace-migration-agent/.e2e/supportiq
claude -p "Run /nace-migrate:evaluate on this repository. This is a non-interactive run: complete Phases 1 to 5, save the report, and stop at the Phase 6 question without editing any file." \
  --plugin-dir ~/nace-migration-agent \
  --allowedTools "Read" "Glob" "Grep" "Bash(pwd)" "Bash(ls:*)" "Bash(wc:*)" \
    "mcp__plugin_nace-migrate_nace-migration-agent__get_ai_detection_patterns" \
    "mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template" \
    "mcp__plugin_nace-migrate_nace-migration-agent__generate_migration_plan" \
    "mcp__plugin_nace-migrate_nace-migration-agent__save_migration_report" \
  --output-format json > ../supportiq-run.json
cd ~/nace-migration-agent
ls -la .e2e/supportiq/nace-report.md && git -C .e2e/supportiq status --short
```

Expected: `nace-report.md` exists; `git status` shows only `?? nace-report.md` (no source edits). If the plugin's tools were not found, read `../supportiq-run.json` for the tool names Claude Code used and add them to `--allowedTools`.

- [ ] **Step 2: Grade supportiq against its key**

For each row of `docs/examples/answer-keys/supportiq.md`, find the report line and mark pass/fail. Then check for missed calls:

```bash
grep -rnE "chat\.completions\.create|responses\.create|messages\.create|/v1/chat/completions" .e2e/supportiq/src --include=*.py
```

Every hit must be a row in the key or listed in the report. Write the outcome into `docs/examples/results.md`:

```markdown
# End-to-end results

| Repo | Row | Expected | Reported | Pass |
|---|---|---|---|---|
| supportiq | S1 | drex_choice | <type and file:line from the report> | yes/no |
```

- [ ] **Step 3: Run and grade opp-agent the same way**

Repeat Step 1 in `.e2e/opp-agent` (output to `../opp-agent-run.json`), then grade against `answer-keys/opp-agent.md`, with this missed-call grep:

```bash
grep -rnE "generateObject|generateText|streamText|new PDFParse|createWorker|\.recognize\(" .e2e/opp-agent/apps --include=*.ts | grep -vE "node_modules|\.spec\.|__CLEANUP__"
```

Append the rows to `docs/examples/results.md`.

- [ ] **Step 4: Fix and rerun on any failure**

For each failed row, find the cause in the run transcript (`../<repo>-run.json`): a missed pattern (fix `src/tools/patterns.ts` with a test in `tests/patterns.test.ts`), or a sorting rule the skill states unclearly (fix `skills/evaluate/SKILL.md`, then `cp` it to `.agents/`). Rebuild with `npm run bundle`, run `npm test`, delete the old `nace-report.md`, and rerun that repo's Steps 1-2. Stop after three rounds and report the remaining failures to Saruar rather than tuning the key.

- [ ] **Step 5: Keep the reports and commit**

```bash
cp .e2e/supportiq/nace-report.md docs/examples/supportiq-nace-report.md
cp .e2e/opp-agent/nace-report.md docs/examples/opp-agent-nace-report.md
git add docs/examples skills .agents src dist tests
git commit -m "Add end-to-end reports for supportiq and opp-agent with graded results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Apply one migration per repo and run it live

**Files:**
- Create: `docs/examples/migrations.md`
- Scratch only (not committed): `.e2e/supportiq-migrated/`, `.e2e/opp-agent-migrated/`

**Interfaces:**
- Consumes: the reports from Task 11, the Phase 6 instructions.
- Produces: evidence that a Drex migration and an NDI migration run against the live API.

- [ ] **Step 1: Apply the Drex migration in a copy of supportiq**

```bash
cd ~/nace-migration-agent/.e2e
rm -rf supportiq-migrated && cp -R supportiq supportiq-migrated && cd supportiq-migrated
claude -p "Use /nace-migrate:evaluate Phase 6 in select mode on the existing nace-report.md: apply only the Ticket category site in src/services/classifier.py. The user approves that one change; apply nothing else." \
  --plugin-dir ~/nace-migration-agent \
  --allowedTools "Read" "Glob" "Grep" "Edit" "Bash(pwd)" \
    "mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template" \
  --output-format json > ../supportiq-migrate.json
git diff --stat
```

Expected: one file changed, `src/services/classifier.py`, using `nace.system_one` with `Choice` and the eight original category keys.

- [ ] **Step 2: Run the migrated classifier once**

`NACE_API_KEY` must be exported as in Task 9 Step 3.

```bash
python3 -m venv ../venv-supportiq
../venv-supportiq/bin/pip install --quiet nace-sdk==0.1.0 openai loguru tenacity redis pydantic pydantic-settings
cat > ../drive_supportiq.py <<'EOF'
import asyncio, sys
sys.path.insert(0, ".")
from src.services.classifier import TicketClassifier

async def main():
    result = await TicketClassifier().classify("I was charged twice for my March invoice and want a refund.")
    print(result)

asyncio.run(main())
EOF
OPENAI_API_KEY=sk-not-used NACE_API_KEY=$NACE_API_KEY ../venv-supportiq/bin/python ../drive_supportiq.py
```

Expected: a result whose `primary_category` is the billing category, with no OpenAI request (the dummy key would fail one). If an import fails on a missing package, install that one package and rerun; if the module still cannot be imported, copy the migrated method into the driver verbatim, run that, and record that you did.

- [ ] **Step 3: Apply the NDI migration in a copy of opp-agent**

```bash
cd ~/nace-migration-agent/.e2e
rm -rf opp-agent-migrated && cp -R opp-agent opp-agent-migrated && cd opp-agent-migrated
claude -p "Use /nace-migrate:evaluate Phase 6 in select mode on the existing nace-report.md: apply only the OCR site in apps/backend/src/modules/extraction/ocr.service.ts (recognizeText). The user approves that one change; apply nothing else." \
  --plugin-dir ~/nace-migration-agent \
  --allowedTools "Read" "Glob" "Grep" "Edit" "Bash(pwd)" \
    "mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template" \
  --output-format json > ../opp-agent-migrate.json
git diff --stat
```

Expected: one file changed, `ocr.service.ts`, uploading the image buffer with `nace.documents.upload(new Blob([...]), { file_name, on_conflict: "new_version" })` and reading `document.markdown`, keeping the `OcrResult` return shape.

- [ ] **Step 4: Run the migrated OCR method once**

```bash
cd ~/nace-migration-agent
sips -s format png tests/fixtures/sample-invoice.pdf --out .e2e/sample-invoice.png >/dev/null
```

Create `.e2e/drive_ocr.ts` containing: the imports the migrated method needs (`NaceClient`, `workspaceFile` from `nace-sdk`), the migrated method body copied verbatim from `.e2e/opp-agent-migrated/apps/backend/src/modules/extraction/ocr.service.ts` as a plain `async function recognizeText(imageBuffer: Buffer)`, and:

```ts
import { readFileSync } from "node:fs";
console.log(await recognizeText(readFileSync(".e2e/sample-invoice.png")));
```

```bash
NACE_API_KEY=$NACE_API_KEY node node_modules/tsx/dist/cli.mjs .e2e/drive_ocr.ts
```

Expected: an `OcrResult` whose text contains `INV-1042`. (The NestJS class is not imported because that needs the app's whole dependency tree; the method body is run as written.)

- [ ] **Step 5: Record and commit**

Write `docs/examples/migrations.md` with, for each repo: the diff (`git -C .e2e/<copy> diff`), the command run, its output, and whether the module was imported or the method copied.

```bash
git add docs/examples/migrations.md
git commit -m "Record a live Drex migration (supportiq) and NDI migration (opp-agent)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Publish the fork (only with Saruar's OK)

**Files:**
- None new.

- [ ] **Step 1: Ask Saruar**

Ask: "Everything passes locally. OK to create the public fork `saruar-dev/nace-migration-agent` and push the `nace` branch?" Do not continue without a yes.

- [ ] **Step 2: Fork and push**

```bash
cd ~/nace-migration-agent
gh repo fork scaledown-team/SLM_Agent --clone=false --fork-name nace-migration-agent
git remote add origin https://github.com/saruar-dev/nace-migration-agent.git
git push -u origin nace
```

If `--fork-name` is not supported by the installed `gh`, fork without it and rename: `gh api -X PATCH repos/saruar-dev/SLM_Agent -f name=nace-migration-agent`.

- [ ] **Step 3: Verify the install path works from GitHub**

In a scratch directory, in Claude Code: `/plugin marketplace add saruar-dev/nace-migration-agent`, `/plugin install nace-migrate@nace`, `/reload-plugins`; confirm `/nace-migrate:evaluate` is listed. Report the repo URL and the two example reports to Saruar.
