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
