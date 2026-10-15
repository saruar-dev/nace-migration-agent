import { NDI_TOOLS, type NdiPrices, type NdiTool } from "./tools/types.js";

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * NDI prices per tool, in USD per 1,000 pages (per 1,000 targets for ground).
 * NACE_NDI_PRICES reads "parse=1.5,extract=4.5"; the tool argument wins, tool by
 * tool. Anything that is not a known tool with a positive number is ignored.
 */
export function resolveNdiPrices(arg?: NdiPrices | null, env: string | undefined = process.env.NACE_NDI_PRICES): NdiPrices {
  const prices: NdiPrices = {};
  for (const part of (env ?? "").split(",")) {
    const [name, value] = part.split("=").map((x) => x.trim());
    const n = value ? Number(value) : NaN;
    if ((NDI_TOOLS as readonly string[]).includes(name) && positive(n)) prices[name as NdiTool] = n;
  }
  for (const tool of NDI_TOOLS) {
    const n = arg?.[tool];
    if (positive(n)) prices[tool] = n;
  }
  return prices;
}
