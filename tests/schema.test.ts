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
