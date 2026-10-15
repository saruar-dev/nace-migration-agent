import type { ArchitectureOverview, Finding } from "../schema.js";
import { DREX_MODEL, DREX_USD_PER_M_INPUT, PRICES_AS_OF, estimateCost, formatUsd, type CostEstimate } from "./pricing.js";
import { NACE_TYPES, NDI_TOOLS, TYPE_LABELS, productOf, type NaceType, type NdiPrices, type NdiTool, type Product } from "./types.js";

export interface ReportOptions {
  projectName?: string;
  filesScanned?: number;
  architecture?: ArchitectureOverview;
  /** NDI prices per tool (USD per 1,000 pages); tools without one are shown in credits. */
  ndiPrices?: NdiPrices;
  /** Fixed time for reproducible output (tests). */
  now?: Date;
}

interface Site {
  finding: Finding;
  primary: NaceType;
  estimate: CostEstimate | null;
}

function creditsText(unpriced: Partial<Record<NdiTool, number>>, times: number): string {
  return NDI_TOOLS.filter((t) => unpriced[t])
    .map((t) => {
      const n = unpriced[t]! * times;
      return `${n.toLocaleString("en-US")} ${t} credit${n === 1 ? "" : "s"}`;
    })
    .join(" + ");
}
const money = (usd: number | null) => (usd === null ? "not estimated" : formatUsd(usd));
const location = (f: Finding) => (f.line_number ? `${f.file_path}:${f.line_number}` : f.file_path);

function newPath(e: Pick<CostEstimate, "after_usd" | "ndi_unpriced">, times: number): string {
  if (e.after_usd === null) return "not estimated";
  const credits = creditsText(e.ndi_unpriced, times);
  if (!credits) return formatUsd(e.after_usd * times);
  if (e.after_usd === 0) return credits;
  return `${formatUsd(e.after_usd * times)} + ${credits}`;
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

  const ndiPrices = opts.ndiPrices ?? {};
  const sites: Site[] = findings
    .filter((f) => f.opportunities.length > 0)
    .map((f) => ({ finding: f, primary: f.opportunities[0].type, estimate: f.cost ? estimateCost(f.cost, ndiPrices) : null }));
  const kept = findings.filter((f) => f.opportunities.length === 0);
  const count = (p: Product) => sites.filter((s) => productOf(s.primary) === p).length;

  const full = sites.filter((s) => s.estimate && s.estimate.before_usd !== null && s.estimate.after_usd !== null);
  const totalBefore = full.reduce((n, s) => n + s.estimate!.before_usd!, 0);
  const unpriced: Partial<Record<NdiTool, number>> = {};
  for (const s of full) {
    for (const t of NDI_TOOLS) if (s.estimate!.ndi_unpriced[t]) unpriced[t] = (unpriced[t] ?? 0) + s.estimate!.ndi_unpriced[t]!;
  }
  const totalAfter = { after_usd: full.reduce((n, s) => n + s.estimate!.after_usd!, 0), ndi_unpriced: unpriced };
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
| Estimated cost of 1,000 runs of each estimated site, today | ${full.length ? formatUsd(totalBefore * 1000) : "not estimated"} |
| Same, with nace | ${full.length ? newPath(totalAfter, 1000) : "not estimated"} |
${missing > 0 ? `| Sites without a full estimate | ${missing} |\n` : ""}`;

  const drexIntro = `Drex answers typed questions about text with calibrated probabilities. \`${DREX_MODEL}\` costs $${DREX_USD_PER_M_INPUT} per million input tokens; output is free.`;
  const priced = NDI_TOOLS.filter((t) => ndiPrices[t] !== undefined);
  const ndiIntro =
    "NDI reads files and bills credits per page: parse 1, split 1, classify 2, extract 3, ground 5 per target. Each tool has its own price." +
    (priced.length ? ` Priced per 1,000 pages: ${priced.map((t) => `${t} ${formatUsd(ndiPrices[t]!)}`).join(", ")}.` : "") +
    (priced.length < NDI_TOOLS.length
      ? " Tools without a price are shown in credits; set NACE_NDI_PRICES (USD per 1,000 pages per tool, from the console's Models & pricing page) to see dollars."
      : "");

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
