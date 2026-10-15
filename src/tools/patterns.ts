/** File extensions scanned for each language. Single source of truth. */
export const PYTHON_EXTENSIONS = [".py"];
export const TS_JS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export interface ProviderPattern {
  provider: string;
  language: "python" | "typescript" | "javascript" | "any";
  /**
   * grep -E patterns for the provider's import/require lines. A file counts as
   * using this provider if any of these match.
   */
  import_patterns: string[];
  /**
   * grep -E patterns that locate the call lines. Some are generic names (e.g.
   * `messages.create`, `generateText`) that other libraries also use, so a
   * match only counts when the same file also matches an import pattern.
   */
  call_patterns: string[];
  /**
   * Call patterns distinctive enough to flag a file on their own, without an
   * import — e.g. a client object injected from another module.
   */
  strong_call_patterns: string[];
  /** human-readable description of what these patterns detect */
  description: string;
  /** file extensions to search */
  extensions: string[];
}

// Matches `from "pkg"`, `from 'pkg/sub'`, `require("pkg")`, `import("pkg")`
const jsImport = (pkg: string) => [
  `from ['"]${pkg}(/[^'"]*)?['"]`,
  `(require|import)\\(['"]${pkg}(/[^'"]*)?['"]\\)`,
];

export const AI_PROVIDER_PATTERNS: ProviderPattern[] = [
  // ── Python: OpenAI v1 ────────────────────────────────────────────────────
  {
    provider: "openai",
    language: "python",
    import_patterns: ["^[[:space:]]*from openai(\\.[a-z_.]+)? import", "^[[:space:]]*import openai"],
    call_patterns: [
      "chat\\.completions\\.create",
      "completions\\.create",
      "responses\\.create",
    ],
    strong_call_patterns: ["chat\\.completions\\.create", "responses\\.create"],
    description: "OpenAI Python SDK v1 (openai>=1.0), Chat Completions and Responses APIs",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: OpenAI v0 (legacy) ───────────────────────────────────────────
  {
    provider: "openai_legacy",
    language: "python",
    import_patterns: ["^[[:space:]]*import openai"],
    call_patterns: [
      "openai\\.ChatCompletion\\.create",
      "openai\\.Completion\\.create",
      "openai\\.Embedding\\.create",
    ],
    strong_call_patterns: [
      "openai\\.ChatCompletion\\.create",
      "openai\\.Completion\\.create",
    ],
    description: "OpenAI Python SDK v0 (openai<1.0, legacy)",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: Anthropic ────────────────────────────────────────────────────
  {
    provider: "anthropic",
    language: "python",
    import_patterns: ["^[[:space:]]*from anthropic(\\.[a-z_.]+)? import", "^[[:space:]]*import anthropic"],
    call_patterns: [
      "messages\\.create",
      "messages\\.stream",
      "anthropic\\.(Async)?Anthropic\\(",
    ],
    strong_call_patterns: [],
    description: "Anthropic Python SDK",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: LangChain ────────────────────────────────────────────────────
  {
    provider: "langchain",
    language: "python",
    import_patterns: ["^[[:space:]]*from langchain", "^[[:space:]]*import langchain"],
    call_patterns: [
      "ChatOpenAI",
      "ChatAnthropic",
      "LLMChain",
      "RetrievalQA",
      "VectorstoreIndexCreator",
      "load_qa_chain",
      "ConversationalRetrievalChain",
      "\\.invoke\\(",
    ],
    strong_call_patterns: [],
    description: "LangChain (Python), including langchain_openai / langchain_core packages",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: LlamaIndex ───────────────────────────────────────────────────
  {
    provider: "llamaindex",
    language: "python",
    import_patterns: ["^[[:space:]]*from llama_index", "^[[:space:]]*import llama_index"],
    call_patterns: [
      "VectorStoreIndex",
      "ServiceContext",
      "QueryEngine",
      "as_query_engine",
      "llama_index\\.llms",
      "\\.query\\(",
    ],
    strong_call_patterns: [],
    description: "LlamaIndex (Python)",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: Cohere ───────────────────────────────────────────────────────
  {
    provider: "cohere",
    language: "python",
    import_patterns: ["^[[:space:]]*import cohere", "^[[:space:]]*from cohere import"],
    call_patterns: [
      "co\\.chat",
      "co\\.generate",
      "co\\.classify",
      "co\\.summarize",
      "cohere\\.(Client|ClientV2)",
    ],
    strong_call_patterns: [],
    description: "Cohere Python SDK",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: Google Gen AI (current) + Generative AI (legacy) ─────────────
  {
    provider: "google_genai",
    language: "python",
    import_patterns: [
      "^[[:space:]]*from google import genai",
      "^[[:space:]]*import google\\.genai",
      "^[[:space:]]*from google\\.genai",
      "^[[:space:]]*import google\\.generativeai",
      "^[[:space:]]*from google\\.generativeai",
      "^[[:space:]]*from google import generativeai",
    ],
    call_patterns: [
      "genai\\.Client\\(",
      "models\\.generate_content",
      "generate_content_stream",
      "chats\\.create",
      "genai\\.GenerativeModel",
      "\\.generate_content",
      "genai\\.configure",
    ],
    strong_call_patterns: ["models\\.generate_content"],
    description:
      "Google Gen AI Python SDK (google-genai: `from google import genai`) and the legacy Generative AI SDK (google-generativeai)",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── TypeScript/JS: OpenAI ────────────────────────────────────────────────
  {
    provider: "openai",
    language: "typescript",
    import_patterns: jsImport("openai"),
    call_patterns: [
      "chat\\.completions\\.create",
      "completions\\.create",
      "responses\\.create",
    ],
    strong_call_patterns: ["chat\\.completions\\.create", "responses\\.create"],
    description: "OpenAI Node.js SDK, Chat Completions and Responses APIs",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: Anthropic ─────────────────────────────────────────────
  {
    provider: "anthropic",
    language: "typescript",
    import_patterns: jsImport("@anthropic-ai/sdk"),
    call_patterns: ["messages\\.create", "messages\\.stream"],
    strong_call_patterns: [],
    description: "Anthropic Node.js SDK",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: LangChain ─────────────────────────────────────────────
  {
    provider: "langchain",
    language: "typescript",
    import_patterns: [...jsImport("@langchain/[^'\"]+"), ...jsImport("langchain")],
    call_patterns: [
      "ChatOpenAI",
      "ChatAnthropic",
      "LLMChain",
      "RetrievalQAChain",
      "\\.invoke\\(",
    ],
    strong_call_patterns: [],
    description: "LangChain.js",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: Vercel AI SDK ─────────────────────────────────────────
  {
    provider: "vercel_ai",
    language: "typescript",
    import_patterns: [...jsImport("ai"), ...jsImport("@ai-sdk/[^'\"]+")],
    call_patterns: [
      "generateText",
      "streamText",
      "generateObject",
      "streamObject",
    ],
    strong_call_patterns: [],
    description: "Vercel AI SDK",
    extensions: TS_JS_EXTENSIONS,
  },
];

/** Returns all patterns as a flat list, optionally filtered by language */
export function getDetectionPatterns(
  language?: "python" | "typescript" | "javascript"
): ProviderPattern[] {
  if (!language) return AI_PROVIDER_PATTERNS;
  const lang = language === "javascript" ? "typescript" : language;
  return AI_PROVIDER_PATTERNS.filter(
    (p) => p.language === lang || p.language === "any"
  );
}

/** Returns the unique file extensions to scan for a given language */
export function getExtensionsForLanguage(
  language: "python" | "typescript" | "javascript" | "all"
): string[] {
  if (language === "python") return PYTHON_EXTENSIONS;
  if (language === "typescript" || language === "javascript")
    return TS_JS_EXTENSIONS;
  return [...PYTHON_EXTENSIONS, ...TS_JS_EXTENSIONS];
}
