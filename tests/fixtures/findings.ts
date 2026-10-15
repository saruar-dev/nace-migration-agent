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
