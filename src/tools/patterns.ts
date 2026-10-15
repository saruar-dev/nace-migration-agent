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
  /** "llm" for model providers, "document" for PDF/OCR/document-AI libraries. */
  kind: "llm" | "document";
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
    kind: "llm",
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
  // ── Any language: LLM endpoints called without an SDK ────────────────────
  {
    provider: "raw_http_llm",
    language: "any",
    kind: "llm",
    import_patterns: [],
    call_patterns: [],
    strong_call_patterns: [
      "/v1/chat/completions",
      "/v1/messages",
      "/v1/responses",
      "api\\.openai\\.com",
      "api\\.anthropic\\.com",
      "openrouter\\.ai/api",
      "generativelanguage\\.googleapis\\.com",
    ],
    description: "LLM HTTP endpoints called with requests, httpx, fetch or axios instead of an SDK",
    extensions: [...PYTHON_EXTENSIONS, ...TS_JS_EXTENSIONS],
  },
  // ── Python: PDF text libraries ────────────────────────────────────────────
  {
    provider: "pdf_text",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+(pypdf|PyPDF2|pdfplumber|fitz|pymupdf|pdfminer)([[:space:].,]|$)",
    ],
    call_patterns: [
      "PdfReader\\(",
      "pdfplumber\\.open\\(",
      "fitz\\.open\\(",
      "pymupdf\\.open\\(",
      "extract_text\\(",
      "get_text\\(",
    ],
    strong_call_patterns: [],
    description: "PDF text extraction: pypdf, PyPDF2, pdfplumber, PyMuPDF (fitz), pdfminer",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: local OCR ─────────────────────────────────────────────────────
  {
    provider: "local_ocr",
    language: "python",
    kind: "document",
    import_patterns: ["^[[:space:]]*(from|import)[[:space:]]+(pytesseract|easyocr|paddleocr)([[:space:].,]|$)"],
    call_patterns: ["image_to_string\\(", "image_to_data\\(", "readtext\\(", "PaddleOCR\\(", "\\.ocr\\("],
    strong_call_patterns: [],
    description: "Local OCR: pytesseract, EasyOCR, PaddleOCR",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: document parsers ─────────────────────────────────────────────
  {
    provider: "doc_parsers",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+(unstructured|docling|llama_parse|llama_cloud_services|marker)([[:space:].,]|$)",
    ],
    call_patterns: ["partition(_pdf|_image|_docx)?\\(", "DocumentConverter\\(", "LlamaParse\\(", "load_data\\(", "PdfConverter\\("],
    strong_call_patterns: [],
    description: "Document parsers: unstructured, docling, LlamaParse, marker",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── Python: cloud OCR ────────────────────────────────────────────────────
  {
    provider: "cloud_ocr",
    language: "python",
    kind: "document",
    import_patterns: [
      "^[[:space:]]*(from|import)[[:space:]]+azure\\.ai\\.(formrecognizer|documentintelligence)",
      "^[[:space:]]*from[[:space:]]+google\\.cloud[[:space:]]+import[[:space:]]+documentai",
      "^[[:space:]]*(from|import)[[:space:]]+google\\.cloud\\.documentai",
    ],
    call_patterns: [
      "analyze_expense\\(",
      "analyze_document\\(",
      "detect_document_text\\(",
      "start_document_analysis\\(",
      "begin_analyze_document\\(",
      "process_document\\(",
    ],
    strong_call_patterns: ["client\\([[:space:]]*['\"]textract['\"]"],
    description: "Cloud OCR: AWS Textract (boto3), Azure Document Intelligence, Google Document AI",
    extensions: PYTHON_EXTENSIONS,
  },
  // ── TypeScript/JS: PDF text libraries ────────────────────────────────────
  {
    provider: "pdf_text",
    language: "typescript",
    kind: "document",
    import_patterns: [...jsImport("pdf-parse"), ...jsImport("pdfjs-dist"), ...jsImport("pdf2json"), ...jsImport("unpdf")],
    call_patterns: ["new PDFParse\\(", "pdfParse\\(", "getDocument\\(", "getTextContent\\(", "getText\\(", "extractText\\("],
    strong_call_patterns: [],
    description: "PDF text extraction: pdf-parse, pdfjs-dist, pdf2json, unpdf",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: local OCR ─────────────────────────────────────────────
  {
    provider: "local_ocr",
    language: "typescript",
    kind: "document",
    import_patterns: jsImport("tesseract\\.js"),
    call_patterns: ["createWorker\\(", "\\.recognize\\("],
    strong_call_patterns: [],
    description: "Local OCR: tesseract.js",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: document parsers ──────────────────────────────────────
  {
    provider: "doc_parsers",
    language: "typescript",
    kind: "document",
    import_patterns: [...jsImport("llama-cloud-services"), ...jsImport("llamaindex")],
    call_patterns: ["LlamaParseReader", "LlamaParse\\(", "loadData\\("],
    strong_call_patterns: [],
    description: "Document parsers: LlamaParse (llama-cloud-services, llamaindex)",
    extensions: TS_JS_EXTENSIONS,
  },
  // ── TypeScript/JS: cloud OCR ─────────────────────────────────────────────
  {
    provider: "cloud_ocr",
    language: "typescript",
    kind: "document",
    import_patterns: [
      ...jsImport("@aws-sdk/client-textract"),
      ...jsImport("@azure/ai-form-recognizer"),
      ...jsImport("@azure-rest/ai-document-intelligence"),
      ...jsImport("@google-cloud/documentai"),
    ],
    call_patterns: [
      "AnalyzeExpenseCommand",
      "AnalyzeDocumentCommand",
      "DetectDocumentTextCommand",
      "beginAnalyzeDocument",
      "processDocument\\(",
    ],
    strong_call_patterns: [],
    description: "Cloud OCR: AWS Textract, Azure Document Intelligence, Google Document AI",
    extensions: TS_JS_EXTENSIONS,
  },
];

/**
 * In a file that uses an LLM provider, a match means the call sends a file or
 * image to the model, so it is a candidate for NDI. Ignore matches in files
 * without an LLM provider.
 */
export const LLM_FILE_INPUT_PATTERNS = [
  "image_url",
  "input_image",
  "input_file",
  "['\"]?type['\"]?[[:space:]]*:[[:space:]]*['\"](image|file|document)['\"]",
  "application/pdf",
  "base64",
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
