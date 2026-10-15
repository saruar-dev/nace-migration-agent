import type { CostAfterStep, CostBlock, NdiPrices, NdiTool } from "./types.js";

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
  /** USD per call on the new path, excluding NDI tools without a price; null when an LLM step could not be priced. */
  after_usd: number | null;
  /** NDI credits per call for tools without a price, by tool. */
  ndi_unpriced: Partial<Record<NdiTool, number>>;
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

export function estimateCost(cost: CostBlock, ndiPrices: NdiPrices): CostEstimate {
  const notes: string[] = [];
  const b = cost.before;
  let before_usd: number | null;
  if (b.kind === "llm") {
    before_usd = llmCost(b.model, b.input_tokens, b.output_tokens, notes);
  } else if (b.kind === "local") {
    before_usd = 0;
    if (cost.after.some((s) => s.handler === "ndi")) {
      notes.push(
        `${b.library} is free today, so NDI adds cost here; the case for moving is accuracy on scans and layouts, and citations, not price`,
      );
    }
  } else {
    const price = lookupOcrPrice(b.service);
    before_usd = price ? price.per_page * b.pages : null;
    if (!price) notes.push(`${b.service}: no published per-page price, not estimated`);
  }

  let after_usd: number | null = 0;
  const ndi_unpriced: Partial<Record<NdiTool, number>> = {};
  for (const step of cost.after) {
    if (step.handler === "drex") {
      if (after_usd !== null) after_usd += perMillion(step.input_tokens, DREX_USD_PER_M_INPUT);
    } else if (step.handler === "ndi") {
      const credits = ndiCredits(step);
      const per1000 = ndiPrices[step.tool];
      if (per1000 === undefined) ndi_unpriced[step.tool] = (ndi_unpriced[step.tool] ?? 0) + credits;
      else if (after_usd !== null) after_usd += (credits * per1000) / (1000 * NDI_CREDITS_PER_UNIT[step.tool]);
    } else {
      const c = llmCost(step.model, step.input_tokens, step.output_tokens, notes);
      after_usd = after_usd === null || c === null ? null : after_usd + c;
    }
  }

  const unpricedTools = Object.keys(ndi_unpriced);
  if (unpricedTools.length) notes.push(`NDI price not set for ${unpricedTools.join(", ")} (NACE_NDI_PRICES); shown in credits`);
  return { before_usd, after_usd, ndi_unpriced, notes };
}

export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n < 0.000001) return "<$0.000001";
  return `$${parseFloat(n.toPrecision(3))}`;
}
