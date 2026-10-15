# nace-migration-agent: design

Date: 2026-10-15. Author: Saruar. Status: draft for review.

## Why

On 2026-10-14 Zhanibek shared [scaledown-team/SLM_Agent](https://github.com/scaledown-team/SLM_Agent) and asked whether we can build something similar for Drex. SLM_Agent is a Claude Code plugin and MCP server that scans a codebase for AI API calls, writes a migration report that names the ScaleDown model for each call, and rewrites the calls on approval.

This fork does the same for nace's two products:

- **Drex**: typed decisions (`choice`, `noul`, `score`) with calibrated probabilities, $0.06 per million input tokens on `drex-v2.0`, output free.
- **NDI** (Perception): document `parse`, `split`, `classify`, `extract`, `ground`, billed in credits per page.

Both use one `nace_sk_` key (`NACE_API_KEY`), the base URL `https://console.nace.ai`, and the official `nace-sdk` client for Python and TypeScript.

The deliverable is a **prototype for Zhanibek**: a working fork that produces a correct report on two real open-source repos and migrates one Drex site and one NDI site that then run against the live API. Whether it later merges into Drexify (`nace-ai/drex-agent-skills`, owned by Raman Saparkhan) or ships on its own is decided after the demo.

## How it works (unchanged from SLM_Agent)

The scan runs locally and calls neither nace nor any other API. The user's coding agent (Claude Code, Cursor) does the analysis, following `skills/evaluate/SKILL.md`. The MCP server only returns fixed data (search patterns, code templates, prices) and does deterministic work (building the report, cost arithmetic, writing the file). nace APIs are called only when the user runs code that was migrated.

## Scope

In scope:

1. Scan Python and TypeScript/JavaScript files for LLM calls and document-processing calls.
2. Sort each call into a Drex type, an NDI tool, or "stays on the LLM", with confidence, complexity, and a decomposition for calls that do several jobs.
3. A cost estimate per site and in the summary.
4. Write `nace-report.md` to the project root.
5. Apply approved migrations using `nace-sdk` templates.

Out of scope:

- SLM_Agent's `optimize` skill (removed).
- Non-LLM heuristics such as keyword lists or regexes that guess meaning (Drexify covers these).
- Jupyter notebooks, tests, examples, vendored and generated code (as in SLM_Agent).
- Publishing to npm or to a public plugin marketplace.

## Repository

- Local clone `~/nace-migration-agent`, branch `nace`, remote `upstream` = scaledown-team/SLM_Agent at `ec2df3c`.
- GitHub fork under `saruar-dev`, renamed `nace-migration-agent`. Created only after Saruar confirms, because it is a public repo.
- SLM_Agent declares MIT in `package.json` but ships no LICENSE file. The fork adds `LICENSE` (MIT, ScaleDown's copyright plus ours) and credits SLM_Agent in the README.
- Package name `nace-migration-agent`, plugin name `nace-migrate`, MCP server name `nace-migration-agent`, command `/nace-migrate:evaluate`.

## Components

| File | Purpose | Change |
|---|---|---|
| `src/index.ts` | MCP server, four tools | Rename server; keep tool names; extend the finding schema with `cost` (below); read `NACE_NDI_PRICES`. |
| `src/tools/patterns.ts` | Search patterns | Keep LLM providers; add raw-HTTP LLM calls and document-pipeline providers (below). |
| `src/tools/templates.ts` | Before/after snippets | Replace with eight nace types (below). |
| `src/tools/pricing.ts` | New. Price table and cost arithmetic | Pure functions, no I/O. |
| `src/tools/analyzer.ts` | Report builder | New report layout (below), uses `pricing.ts`. |
| `skills/evaluate/SKILL.md` | Agent instructions | Rewritten for Drex/NDI rules; same phase structure. `.agents/skills/evaluate/SKILL.md` is a copy. |
| `skills/optimize/`, `.agents/skills/optimize/` | | Deleted. |
| `.claude-plugin/*.json`, `.mcp.json` | Plugin metadata | nace names; `.mcp.json` runs `node ${CLAUDE_PLUGIN_ROOT}/dist/index.js`. |
| `dist/index.js` | Bundled server | Built with esbuild into one file with dependencies inlined, and committed, so installing the plugin from git needs no npm publish or `npm install`. `dist/` is removed from `.gitignore`. |
| `tests/` | New | vitest unit tests. |

The four MCP tools keep their names and roles: `get_ai_detection_patterns`, `get_integration_template`, `generate_migration_plan`, `save_migration_report` (now writes `nace-report.md`).

## Opportunity types

Eight types replace ScaleDown's four:

| Type | Product | Shape |
|---|---|---|
| `drex_choice` | Drex | one label from a fixed set |
| `drex_noul` | Drex | yes/no probability |
| `drex_score` | Drex | position on an ordered rubric |
| `ndi_parse` | NDI | file to Markdown/text |
| `ndi_split` | NDI | multi-document packet to segments, each with a class |
| `ndi_classify` | NDI | document or page to one of the user's classes |
| `ndi_extract` | NDI | file to a JSON schema, with citations |
| `ndi_ground` | NDI | locate quotes or values in a file |

## Sorting rules

The agent traces each call to its real prompt and to what the code does with the result, then applies these rules:

| The code... | Type |
|---|---|
| branches on one label from a fixed set (route, intent, category) | `drex_choice` |
| branches on yes/no (spam, safety, policy violation, groundedness) | `drex_noul` |
| uses an ordered level or a numeric rating (urgency, quality, LLM-judge score, reranking) | `drex_score`; `drex_choice` when only the top candidate is used |
| keeps a subset of candidates | one `drex_noul` per candidate, sent as several questions in one request |
| turns a PDF, scan, image, DOCX or XLSX into text (PDF library, OCR, cloud OCR, "transcribe" prompt to a vision model) | `ndi_parse` |
| fills fields or a schema from a file (vision LLM, Textract AnalyzeExpense, Azure prebuilt models) | `ndi_extract` |
| decides the type of a file or page | `ndi_classify` |
| cuts a multi-document file into documents | `ndi_split` |
| finds where a value or quote appears in a file | `ndi_ground` |
| generates text, chats, summarizes, writes code, embeds, or plans tool calls with generated arguments | stays on the LLM |

Boundary rules:

1. **File or text.** If the input is a file (PDF, image, office document), the site is NDI. If the input is text already in memory, it is Drex. "What type is this PDF" is `ndi_classify`; "what kind of request is this email" is `drex_choice`.
2. **Extraction from short text** stays on the LLM, because NDI takes files. Exception: picking one of several candidates the code already has is `drex_choice`.
3. **A flag returned alongside generated or extracted output** belongs to that output. The call is a site for the flag only when the flag is the main thing the code acts on (Drexify's rule).
4. **One call, several jobs.** If a call does two or more of the jobs above, the agent writes a decomposition: ordered steps, each with a handler `drex`, `ndi` or `llm`, keeping `llm` only for steps that need generation or open reasoning.
5. **Shared helpers.** A generic `call_llm()` used by callers with different purposes produces one finding per distinct caller (SLM_Agent rule, kept).
6. **Dead code** (no production caller) is not reported.

Confidence (high/medium/low) and the 1-5 complexity score keep SLM_Agent's definitions.

## Detection patterns

`get_ai_detection_patterns` keeps SLM_Agent's providers (OpenAI v0/v1, Anthropic, LangChain, LlamaIndex, Cohere, Google GenAI, Vercel AI SDK) and its rules (import patterns decide whether a file uses a provider; generic call names only count in files that import it; strong call patterns count alone). It adds:

**Raw HTTP LLM calls** (any language, strong patterns): URLs or paths for `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `api.openai.com`, `api.anthropic.com`, `openrouter.ai/api`, `generativelanguage.googleapis.com`. These catch code that calls an LLM with `requests`/`fetch` and no SDK.

**Document pipelines:**

| Provider key | Python imports | TS/JS imports | Typical calls |
|---|---|---|---|
| `pdf_text` | `pypdf`, `PyPDF2`, `pdfplumber`, `fitz`/`pymupdf`, `pdfminer` | `pdf-parse`, `pdfjs-dist`, `pdf2json` | `PdfReader(`, `pdfplumber.open(`, `fitz.open(`, `extract_text(`, `getDocument(`, `new PDFParse(` |
| `local_ocr` | `pytesseract`, `easyocr`, `paddleocr` | `tesseract.js` | `image_to_string(`, `readtext(`, `createWorker(`, `recognize(` |
| `doc_parsers` | `unstructured`, `docling`, `llama_parse`, `marker` | `llama-cloud-services` | `partition(`, `DocumentConverter(`, `LlamaParse(` |
| `cloud_ocr` | `boto3` + `textract`, `azure.ai.formrecognizer`, `azure.ai.documentintelligence`, `google.cloud.documentai` | `@aws-sdk/client-textract`, `@azure/ai-form-recognizer`, `@azure-rest/ai-document-intelligence`, `@google-cloud/documentai` | `analyze_expense`, `analyze_document`, `begin_analyze_document`, `process_document`, `AnalyzeExpenseCommand` |

**Files sent inside LLM calls** (counted only in files that use an LLM provider): `image_url`, `input_image`, `input_file`, `"type": "image"`, `type: 'image'`, `type: 'file'`, `application/pdf`, `base64`. A match marks the LLM call as a candidate for NDI.

## Templates

`get_integration_template(opportunity_type, provider, language)` takes the eight types above, a provider and `python` or `typescript`. As in SLM_Agent, when no template exists for the exact provider, it returns the closest one with `exact_match: false` and a note.

Before snippets exist for `openai` and `anthropic` (Python and TS) and `vercel_ai` (TS) on every type, plus `pdf_text` and `local_ocr` for `ndi_parse`. After snippets use `nace-sdk` and show:

- Drex: one `system_one` call with typed questions; criteria as text; reading `result.choices[id].choice`, `result.nouls[id].noul`, `result.scores[id].score`; up to 512 questions per request; the original labels kept as `choice` criteria keys so callers do not change.
- NDI: a file source (URL, or a local file uploaded first), `wait_seconds` on create and `jobs.wait` for longer jobs, reading the result fields of each tool, `parse_mode` left at the default unless the old code did OCR correction.
- Errors raise; no fallback to another provider inside the template.

Exact method names and result fields are taken from the live SDK docs (`/docs/developer-tools/python` and `/typescript`) when the templates are written, and each template is run once against the live API before it is committed.

## Cost estimate

The agent supplies estimates; the server does the arithmetic.

Each finding may carry:

```ts
cost?: {
  before:
    | { kind: "llm"; model: string; input_tokens: number; output_tokens: number }
    | { kind: "ocr_service"; service: string; pages: number }
    | { kind: "local"; library: string };
  after: Array<
    | { handler: "drex"; input_tokens: number }
    | { handler: "ndi"; tool: "parse" | "split" | "classify" | "extract" | "ground"; pages: number; targets?: number; parse_mode?: "low" | "medium" | "high" }
    | { handler: "llm"; model: string; input_tokens: number; output_tokens: number }
  >;
  assumptions: string[];
}
```

`pricing.ts` holds:

- LLM prices per million input and output tokens for the common OpenAI, Anthropic and Google models, copied from each provider's pricing page with an "as of" date. Model ids are matched exactly, then by known alias (for example a dated snapshot to its base id).
- Per-page prices for Textract, Azure Document Intelligence and Google Document AI, from their pricing pages, with the same date.
- Drex: `drex-v2.0` at $0.06 per million input tokens (from `https://console.nace.ai/models`), output free.
- NDI credits per tool: parse 1 per page, split 1 per page, classify 2 per page, extract 3 per page, ground 5 per target per file; `parse_mode: "high"` doubles parse, split, classify and extract. Each tool has its own price. Dollars come from per-tool prices in USD per 1,000 pages (per 1,000 targets for ground), as the logged-in console's Models & pricing page lists them: the `ndi_prices` tool argument or the `NACE_NDI_PRICES` environment variable (`parse=1.5,extract=4.5`). The public docs do not list them. (Amended 2026-10-15 after the final review: the first version assumed one price per credit for every tool.)

Rules:

- Cost per call = sum over `after` steps, compared with `before`. The report shows per call and per 1,000 calls, and the summary shows the total if every site ran 1,000 times.
- A model or service not in the table gives "not estimated" for that side, never a guess.
- A `local` before (pdf-parse, pypdf, tesseract) costs $0. NDI then costs more than today, and the report says so: the case for those sites is accuracy and citations, not price.
- A tool without a price shows credits, per tool, and the totals that include it say so.
- Every figure is labeled as an estimate and lists the finding's `assumptions`.

## Report: `nace-report.md`

1. Header: project name, generated time, report version `1`, "Estimates, not measurements".
2. Summary table: files scanned, files with AI or document calls, sites going to Drex, sites going to NDI, calls staying on the LLM, estimated cost per 1,000 runs of every site, before and after.
3. Architecture overview (SLM_Agent's section, kept).
4. Drex sites, grouped by type. Each: `file:line`, process name, type, confidence, reason, cost line.
5. NDI sites, grouped by tool, same fields.
6. Stays on the LLM: one line each with the reason.
7. Decompositions for calls with complexity 3 or higher.
8. nace API reference: base URL, `Authorization: Bearer $NACE_API_KEY`, the `/v1/systemone` and `/v1/documents/{tool}` request shapes, links to the docs.
9. Setup: `pip install nace-sdk` / `npm install nace-sdk`, `export NACE_API_KEY=...`, signup at https://drex.nace.ai.

## The evaluate skill

Same phases as SLM_Agent, with nace content:

1. **Discovery.** Get patterns, glob candidate files, grep, dedupe by file, report counts by provider (LLM and document providers separately).
2. **Tracing.** Read each call site, trace the prompt and the callers, follow injected clients. For each call record purpose, input kind (file or text), what the code does with the output, model id, and the token and page estimates for the cost block.
3. **Analysis.** Apply the sorting rules, confidence, complexity, decomposition, and the cost block.
4. **Plan.** `pwd`, `generate_migration_plan`, `save_migration_report`, then a short summary to the user.
5. **Decomposition review.** One short paragraph per multi-job call.
6. **Migration.** Ask yes / no / select. For each approved site: get the template, read the file, apply it with the code's real names, keep the existing labels and output shape, let Drex or NDI errors raise. At the end, remind the user to set `NACE_API_KEY`.

Rules carried over: never edit without approval, never skip tracing, always save the report.

## Error handling

- MCP tool inputs are validated with zod as today; an invalid finding returns a tool error naming the field.
- Unknown prices and a missing NDI credit price degrade to "not estimated" or "credits only".
- `save_migration_report` keeps SLM_Agent's absolute-path check.
- Migrated code raises on Drex or NDI failure. It does not silently fall back to the old provider.

## Testing

Unit tests (vitest, `npm test`):

- **Patterns:** each new pattern matches a real-world snippet, and lookalikes do not count (a Twilio `messages.create`, a project's own `generateText`, a `fitz` variable in a file that does not import PyMuPDF).
- **Pricing:** LLM cost, Drex cost, NDI credits including `parse_mode: "high"` and ground targets, missing price, missing credit price.
- **Report:** a fixed list of findings produces the expected sections and totals (snapshot).
- **Templates:** lookup by type, provider and language, including the closest-match fallback.

End-to-end runs, with `/nace-migrate:evaluate` in Claude Code on the plugin installed from the local clone:

| Repo | Commit | Language | Expected |
|---|---|---|---|
| meryemsakin/supportiq (MIT) | `0438e7e` | Python | ticket category (`drex_choice`), sentiment (`drex_choice` if the code acts on a label, `drex_score` if it acts on a number; the answer key fixes which after reading `sentiment.py`), RAG answer stays on the LLM |
| m-ahmedbashir/opp-agent (ISC) | `ec1e787` | TypeScript | pdf-parse and tesseract.js (`ndi_parse`), document-type auto-classification (`ndi_classify`), invoice/receipt/resume `generateObject` (`ndi_extract`), chat route stays on the LLM |

Before each run, an answer key is written by hand from reading the repo, listing every site with its expected type. The run passes when every reported site is real and correctly sorted, no site in the answer key is missing, and a plain grep for the provider patterns finds no unreported AI call in production code.

Live check: in a scratch copy of each repo, apply one migration (a Drex site in supportiq, an NDI site in opp-agent) and run it once against `https://console.nace.ai` with Saruar's prod key. Expected spend is under $0.10.

## Done when

- Unit tests pass.
- Both end-to-end runs pass against their answer keys.
- Both live migrations return a valid response.
- `nace-report.md` from both runs is committed under `docs/examples/` for the demo.
- The README explains install and use, and credits SLM_Agent.
