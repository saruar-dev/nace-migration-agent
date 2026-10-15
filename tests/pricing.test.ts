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
