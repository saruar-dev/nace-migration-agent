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
