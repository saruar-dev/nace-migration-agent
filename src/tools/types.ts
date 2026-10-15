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

/** USD per 1,000 pages (per 1,000 targets for ground), per NDI tool, as the console's Models & pricing page lists them. */
export type NdiPrices = Partial<Record<NdiTool, number>>;

export interface CostBlock {
  before: CostBefore;
  after: CostAfterStep[];
  assumptions: string[];
}
