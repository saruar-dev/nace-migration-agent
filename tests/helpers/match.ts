import type { ProviderPattern } from "../../src/tools/patterns.js";

/** grep -E patterns use the POSIX class [:space:] inside brackets; JS RegExp needs \s. */
export const toJs = (pattern: string) => new RegExp(pattern.replaceAll("[:space:]", "\\s"), "m");

/** usage_guide.rules: a file uses a provider if an import or a strong call pattern matches. */
export function usesProvider(entry: ProviderPattern, source: string): boolean {
  return [...entry.import_patterns, ...entry.strong_call_patterns].some((p) => toJs(p).test(source));
}
