#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDetectionPatterns } from "./tools/patterns.js";
import { getBestTemplate } from "./tools/templates.js";
import { generateMigrationPlanMarkdown } from "./tools/analyzer.js";
import type { Finding, ArchitectureOverview } from "./tools/analyzer.js";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import type { OpportunityType } from "./tools/templates.js";
import { PYTHON_EXTENSIONS, TS_JS_EXTENSIONS } from "./tools/patterns.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

const server = new McpServer({
  name: "scaledown-migration-agent",
  version,
});

// ── Tool 1: get_ai_detection_patterns ────────────────────────────────────────

server.tool(
  "get_ai_detection_patterns",
  `Returns grep-compatible regex patterns for finding AI API calls in a codebase.
Use these patterns with Grep or Bash to locate all files that call AI providers
(OpenAI, Anthropic, LangChain, LlamaIndex, Cohere, Google GenAI, Vercel AI SDK).
Returns patterns for both Python and TypeScript/JavaScript.
Each provider has import_patterns (decide whether a file uses the provider),
call_patterns (locate the call lines; generic names only count when the file also
imports the provider) and strong_call_patterns (distinctive enough to count alone).
See usage_guide.rules.`,
  {
    language: z
      .enum(["python", "typescript", "javascript", "all"])
      .optional()
      .describe(
        "Filter patterns by language. Omit or pass 'all' to get patterns for all languages."
      ),
  },
  async ({ language }) => {
    const lang =
      language === "all" || language === undefined ? undefined : language;
    const patterns = getDetectionPatterns(lang as "python" | "typescript" | "javascript" | undefined);

    const result = {
      patterns,
      usage_guide: {
        bash_example:
          "grep -rn --include='*.py' 'chat\\.completions\\.create' ./src",
        note: "All patterns are grep -E (extended regex) compatible.",
        rules: [
          "Only search files with the entry's `extensions`, skipping `exclude_dirs`.",
          "A file uses a provider if any of its import_patterns match, or any of its strong_call_patterns match.",
          "In a file that uses the provider, call_patterns give the line numbers of the calls.",
          "A call_patterns match in a file with no matching import (e.g. `messages.create` in a Twilio file, or a project's own `generateText`) is not an AI call.",
          "A client can be created in one file and used in another (passed in as a parameter). Phase 2 tracing must follow such clients back to where they are constructed.",
        ],
        file_extensions: {
          python: PYTHON_EXTENSIONS,
          typescript_javascript: TS_JS_EXTENSIONS,
        },
        exclude_dirs: [
          "node_modules",
          ".venv",
          "venv",
          "__pycache__",
          ".git",
          "dist",
          "build",
        ],
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool 2: get_integration_template ─────────────────────────────────────────

server.tool(
  "get_integration_template",
  `Returns a concrete before/after code template showing exactly how to integrate
ScaleDown for a specific opportunity type, AI provider, and language.
Use this to get the exact code changes to make in a file. Every template calls the
ScaleDown HTTP API directly (no SDK). If no template exists for the exact provider,
the closest one is returned with exact_match: false — its after_snippet still
applies, only before_snippet shows a different provider's SDK.

Opportunity types:
- compression:     Add sd_compress before an LLM call to reduce context tokens 50-70%
- classification:  Replace an LLM classification call with sd_classify (~95% cheaper)
- extraction:      Replace an LLM extraction call with sd_extract (~95% cheaper)
- summarization:   Replace an LLM summarization call with sd_summarize (~90% cheaper)`,
  {
    opportunity_type: z
      .enum(["compression", "classification", "extraction", "summarization"])
      .describe("The type of ScaleDown integration to apply."),
    provider: z
      .string()
      .describe(
        "The AI provider in the original code (e.g. 'openai', 'anthropic', 'langchain')."
      ),
    language: z
      .enum(["python", "typescript"])
      .describe("Programming language."),
  },
  async ({ opportunity_type, provider, language }) => {
    const match = getBestTemplate(
      opportunity_type as OpportunityType,
      provider,
      language
    );

    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                found: false,
                message: `No template for ${opportunity_type}. Use the request/response shapes in the "ScaleDown HTTP API" section of scaledown-report.md, or https://docs.scaledown.ai/api-reference/.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const { template, exact_match } = match;
    const notes: string[] = [];
    if (template.provider !== provider.toLowerCase())
      notes.push(
        `No ${provider} template exists; before_snippet shows the ${template.provider} SDK. The after_snippet (the ScaleDown call) is the same for every provider — adapt the surrounding code to ${provider}.`
      );
    if (template.language !== language)
      notes.push(
        `No ${language} template exists; this one is ${template.language}. Port the HTTP call to ${language}.`
      );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              found: true,
              exact_match,
              matched_provider: template.provider,
              matched_language: template.language,
              ...(notes.length ? { match_note: notes.join(" ") } : {}),
              ...template,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Tool 3: generate_migration_plan ──────────────────────────────────────────

const OPPORTUNITY_TYPES = [
  "compression",
  "classification",
  "extraction",
  "summarization",
] as const;

// Models often use the short verb forms; accept them and store the long names.
const SHORT_SLM_TYPES: Record<string, OpportunityType> = {
  compress: "compression",
  classify: "classification",
  extract: "extraction",
  summarize: "summarization",
};

const decompositionStepSchema = z
  .object({
    step: z.number(),
    purpose: z.string(),
    handler: z.enum(["scaledown", "llm"]),
    slm_type: z
      .preprocess(
        (v) => (typeof v === "string" ? SHORT_SLM_TYPES[v] ?? v : v),
        z.enum(OPPORTUNITY_TYPES)
      )
      .optional()
      .describe('Required when handler is "scaledown".'),
    notes: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.handler === "scaledown" && !d.slm_type)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slm_type"],
        message: 'slm_type is required when handler is "scaledown"',
      });
  });

const findingSchema = z.object({
  file_path: z.string(),
  line_number: z.number().nullable().optional(),
  provider: z.string(),
  opportunities: z.array(
    z.object({
      type: z.enum(["compression", "classification", "extraction", "summarization"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
      estimated_savings: z.string(),
    })
  ),
  complexity: z
    .object({
      score: z.number(),
      label: z.string(),
      reasons: z.array(z.string()),
      decomposition: z
        .array(decompositionStepSchema)
        .nullable()
        .optional()
        .describe("Steps for multi-task calls (score >= 3). Omit or null for single-task calls."),
    }),
  code_snippet: z.string(),
});

const architectureOverviewSchema = z.object({
  description: z.string().describe("Plain-English summary of how and where AI is used in the system."),
  patterns: z.array(
    z.object({
      name: z.string().describe("Short name for this usage pattern (e.g. 'RAG pipeline', 'ticket routing')."),
      files: z.array(z.string()).describe("Files involved in this pattern."),
      provider: z.string().describe("AI provider used (e.g. 'openai', 'anthropic')."),
      purpose: z.string().describe("What this pattern does."),
    })
  ).describe("Each distinct AI usage pattern found in the codebase."),
});

server.tool(
  "generate_migration_plan",
  `Generates a structured markdown migration plan from a list of findings.
Call this after you have analyzed all AI API call sites in the codebase.
The plan includes an architecture overview, summary table, complexity breakdown,
per-opportunity sections with confidence levels, complex call decompositions, and setup instructions.
The markdown is returned as text — use save_migration_report to persist it to disk.`,
  {
    findings: z
      .array(findingSchema)
      .describe("Array of findings assembled by Claude, one per AI API call site."),
    project_name: z
      .string()
      .optional()
      .describe("Name of the project/codebase (used in the plan heading)."),
    files_scanned: z
      .number()
      .optional()
      .describe("Total number of files scanned (for the summary table)."),
    architecture_overview: architectureOverviewSchema
      .optional()
      .describe("Overview of how the project currently uses AI — populated from Phase 2 analysis."),
  },
  async ({ findings, project_name, files_scanned, architecture_overview }: { findings: Finding[]; project_name?: string; files_scanned?: number; architecture_overview?: ArchitectureOverview }) => {
    const plan = generateMigrationPlanMarkdown(
      findings,
      project_name,
      files_scanned ?? 0,
      architecture_overview
    );
    return {
      content: [{ type: "text", text: plan }],
    };
  }
);

// ── Tool 4: save_migration_report ─────────────────────────────────────────────

/**
 * Returns an absolute project root, or undefined if the path is relative/empty.
 * On Windows, converts a Git Bash path (`/c/Users/...`), which Node would
 * otherwise resolve to `C:\c\Users\...`.
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
  `Saves the migration report as a markdown file inside the user's project.
Always call this after generate_migration_plan so the report is persisted.
The file is written to <project_root>/scaledown-report.md.
Returns the absolute path of the saved file.`,
  {
    markdown: z
      .string()
      .describe("The markdown string returned by generate_migration_plan."),
    project_root: z
      .string()
      .describe(
        "Absolute path to the root of the user's project (the directory being evaluated)."
      ),
  },
  async ({ markdown, project_root }: { markdown: string; project_root: string }) => {
    const root = normalizeProjectRoot(project_root);
    if (!root) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: false,
              error: `project_root must be an absolute path (got ${JSON.stringify(project_root)}). A relative path would resolve against the MCP server's working directory, not the project.`,
            }),
          },
        ],
      };
    }
    const outPath = join(root, "scaledown-report.md");
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, markdown, "utf8");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ saved: true, path: outPath }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: false,
              error: String(err),
              path: outPath,
            }),
          },
        ],
      };
    }
  }
);

// ── Start server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("ScaleDown migration agent failed to start:", err);
  process.exit(1);
});
