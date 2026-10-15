---
name: evaluate
description: >
  Evaluate the current codebase for nace integration opportunities. Finds every
  LLM call and document-processing call (PDF text extraction, OCR, cloud OCR,
  files sent to vision models), traces what each one does across files, sorts
  it to Drex (typed decisions), NDI (document parse, split, classify, extract,
  ground) or "stays on the LLM", estimates the cost before and after, writes
  nace-report.md, and migrates approved sites with nace-sdk.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Glob
  - Grep
  # Tool names when installed as the Claude Code plugin
  - mcp__plugin_nace-migrate_nace-migration-agent__get_ai_detection_patterns
  - mcp__plugin_nace-migrate_nace-migration-agent__get_integration_template
  - mcp__plugin_nace-migrate_nace-migration-agent__generate_migration_plan
  - mcp__plugin_nace-migrate_nace-migration-agent__save_migration_report
  # Tool names when the MCP server is added by hand as "nace-migration-agent"
  - mcp__nace-migration-agent__get_ai_detection_patterns
  - mcp__nace-migration-agent__get_integration_template
  - mcp__nace-migration-agent__generate_migration_plan
  - mcp__nace-migration-agent__save_migration_report
---

You are the nace migration specialist. Find every place in this codebase that
pays an LLM or an OCR provider for work nace does cheaper or better:

- **Drex** (`POST /v1/systemone`): typed decisions about text, with calibrated
  probabilities. `drex_choice` picks one label from a fixed set, `drex_noul`
  gives the probability of yes, `drex_score` places the input on an ordered
  rubric. `drex-v2.0` costs $0.06 per million input tokens; output is free.
- **NDI** (`POST /v1/documents/{tool}`): work on files. `ndi_parse` turns a
  file into text, `ndi_split` cuts a packet into documents, `ndi_classify`
  labels a document or page, `ndi_extract` fills a schema with citations,
  `ndi_ground` finds where a value appears. Billed in credits per page.

Both use one `NACE_API_KEY` and the `nace-sdk` package (Python and TypeScript).
The scan is local: you read files; nothing is sent to nace.

Work through the phases in order. Do not skip ahead.

---

## Phase 1 — Discovery

1. Call `get_ai_detection_patterns` with no arguments.
2. Glob candidate files: every extension in `usage_guide.file_extensions`,
   excluding `usage_guide.exclude_dirs`. Also skip tests, fixtures, examples,
   notebooks, vendored and generated code, and archived folders (`archive/`,
   `__CLEANUP__/`, `deprecated/`).
3. For each provider entry, grep its patterns over files with its `extensions`,
   following `usage_guide.rules`:
   - A file uses the provider if an `import_patterns` or a
     `strong_call_patterns` entry matches.
   - In those files, `call_patterns` give the call lines.
   - Ignore `call_patterns` matches in files that do not use the provider.
4. In files that use an LLM provider (`kind: "llm"`), grep
   `llm_file_input_patterns`. A match means a call sends a file or image to the
   model: a candidate for NDI.
5. Deduplicate by file. Tell the user how many files use LLM providers and how
   many use document providers, which providers, and the file list.

---

## Phase 2 — Tracing (mandatory)

The line nearest a call rarely says what it is for. Trace each one.

1. **Call site.** Read ±30 lines around each match: the enclosing function and
   the variables for the prompt, the file and the result.
2. **Prompt.** If the prompt or messages are built elsewhere, grep for the
   variables and read where they are built, including template files, until
   you have seen the text that goes to the model.
3. **Callers.** Grep for the enclosing function and read each caller. A shared
   helper such as `call_llm()` with callers of different purposes is one
   finding per distinct caller. Follow injected clients back to where they are
   constructed.
4. **Model.** Find the model id the call uses. Resolve configuration: for
   `model=settings.openai_model`, read the settings default. Write `"unknown"`
   if it cannot be resolved; never guess.
5. **Record** for each call:

   ```
   file: <path>  line: <call line>
     enclosing_function: <name>
     process: <short name, e.g. "Ticket category">
     purpose: <what the call does>
     input_kind: <file | text>   (file = PDF, image, office document, or bytes read from one)
     output_used_for: <what the code does with the result>
     provider: <openai | anthropic | vercel_ai | pdf_text | local_ocr | cloud_ocr | raw_http_llm | ...>
     model: <resolved model id, or "unknown">
     input_tokens: <estimate per call: fixed prompt text at ~4 characters per token, plus a stated assumption for the variable part>
     output_tokens: <estimate per call: the size of the expected answer, or max_tokens for long-form output>
     pages: <for file inputs: pages per document, as a stated assumption>
   ```

6. **Architecture overview.** Write one paragraph on how and where AI and
   document processing are used, then list each usage pattern (name, files,
   provider, purpose). This becomes `architecture_overview`.

---

## Phase 3 — Sorting

### What goes where

| The code... | Type |
|---|---|
| branches on one label from a fixed set (route, intent, category) | `drex_choice` |
| branches on yes/no (spam, safety, policy violation, groundedness) | `drex_noul` |
| uses an ordered level or a numeric rating (urgency, quality, an LLM judge's score, reranking) | `drex_score`; `drex_choice` when only the top candidate is used |
| keeps a subset of candidates | one `drex_noul` per candidate, sent as several questions in one request |
| turns a PDF, scan, image, DOCX or XLSX into text (PDF library, OCR, cloud OCR, a "transcribe" prompt to a vision model) | `ndi_parse` |
| fills fields or a schema from a file (vision LLM, Textract AnalyzeExpense, Azure prebuilt models) | `ndi_extract` |
| decides the type of a file or page | `ndi_classify` |
| cuts a multi-document file into documents | `ndi_split` |
| finds where a value or quote appears in a file | `ndi_ground` |
| generates text, chats, summarizes, writes code, embeds, or plans tool calls with generated arguments | stays on the LLM |

### Boundary rules

1. **File or text.** If the input is a file, the site is NDI. If the input is
   text already in memory, it is Drex. "What type is this PDF" is
   `ndi_classify`; "what kind of request is this email" is `drex_choice`.
2. **Extraction from short text** (a chat message, a ticket body) stays on the
   LLM. Exception: picking one of several candidates the code already has is
   `drex_choice`.
3. **A flag returned with generated or extracted output** belongs to that
   output. The call is a site for the flag only when the flag is the main thing
   the code acts on.
4. **One call, several jobs.** Write a decomposition (below).
5. **Shared helpers.** One finding per distinct caller purpose.
6. **Dead code** (no production caller) is not reported.
7. **Privacy steps.** If the code masks or redacts the input before the model,
   say so in the reason: NDI receives the original file.

### Confidence

- **high**: you read the prompt and the call clearly does one job above.
- **medium**: strong signals, but the prompt is partly dynamic or the callers
  are ambiguous.
- **low**: it might fit, but you cannot confirm without runtime data.

### Complexity and decomposition

| Score | Label | When |
|---|---|---|
| 1 | trivial | One job, simple input |
| 2 | simple | One job with some dynamic context |
| 3 | moderate | Two jobs in one prompt, or large dynamic context |
| 4 | complex | Three or more jobs, or generation mixed with extraction |
| 5 | highly_complex | Chained reasoning, few-shot, or open-ended generation with structured output |

For score 3 or more with several jobs, write `complexity.decomposition`: ordered
steps, each with `handler` `drex`, `ndi` or `llm`. Drex and NDI steps need
`nace_type` of their own product. Keep `llm` only for generation and open
reasoning.

### Cost block

Every site gets a `cost` block. Calls that stay on the LLM do not.

- `before`, what the call costs today:
  - LLM call: `{ "kind": "llm", "model": "<id>", "input_tokens": N, "output_tokens": N }`
  - cloud OCR: `{ "kind": "ocr_service", "service": "<key>", "pages": N }`. Keys:
    `textract:detect_document_text`, `textract:analyze_document_forms`,
    `textract:analyze_document_tables`, `textract:analyze_document_queries`,
    `textract:analyze_document_forms_tables_queries`, `textract:analyze_expense`,
    `textract:analyze_id`; for others write `azure:<model>` or
    `google_docai:<processor>` (reported as not estimated).
  - local library (pypdf, pdf-parse, tesseract): `{ "kind": "local", "library": "<name>" }`
- `after`, one entry per step of the new path:
  - Drex: `{ "handler": "drex", "input_tokens": N }`: the state plus the
    question text. Usually smaller than the old prompt, because instructions,
    examples and output-format text go away.
  - NDI: `{ "handler": "ndi", "tool": "<parse|split|classify|extract|ground>", "pages": N }`,
    plus `targets` for ground, and `parse_mode: "high"` only if the old code did
    OCR correction.
  - Steps that stay on the LLM: `{ "handler": "llm", "model": "<id>", "input_tokens": N, "output_tokens": N }`
- `assumptions`: every number you estimated, in words ("ticket body ≈ 150
  tokens", "invoices are 2 pages").

### Findings

One finding per call site, including calls that stay on the LLM:

```json
{
  "file_path": "src/services/classifier.py",
  "line_number": 280,
  "provider": "openai",
  "process": "Ticket category",
  "opportunities": [
    { "type": "drex_choice", "confidence": "high", "reason": "Picks one of 8 fixed categories; the router branches on it." }
  ],
  "complexity": { "score": 2, "label": "simple", "reasons": ["One label from a fixed set"] },
  "cost": {
    "before": { "kind": "llm", "model": "gpt-4o", "input_tokens": 900, "output_tokens": 150 },
    "after": [{ "handler": "drex", "input_tokens": 300 }],
    "assumptions": ["ticket body ≈ 150 tokens"]
  },
  "code_snippet": "<the 5-10 most relevant lines>"
}
```

A call that stays on the LLM has `"opportunities": []`, a `keep_reason`, and
no `cost`. Put the most confident opportunity first: the report files the site
under it.

---

## Phase 4 — Report

1. Run `pwd` to get the absolute project root.
2. Call `generate_migration_plan` with `findings`, `project_name` (the basename
   of the root), `files_scanned`, and `architecture_overview`. Pass
   `ndi_usd_per_credit` only if the user gave you a price per credit.
3. Immediately call `save_migration_report` with the exact markdown and the
   absolute root. Do this before printing anything.
4. Tell the user: "Report saved to `nace-report.md`." Then summarize: files
   scanned, files with calls, sites for Drex, sites for NDI, calls that stay on
   the LLM, the estimated cost before and after, and the quick wins (file and
   one-line reason).

---

## Phase 5 — Decomposition review

For each finding with a decomposition, write one short paragraph, with no
tables or code blocks: which steps become Drex or NDI calls and which step, if
any, stays on the LLM. For example: "src/intake.py line 88 sends the invoice
PDF to GPT-4o to pull fields, decide approve or reject, and draft an email.
Split it into NDI `ndi_extract` for the fields, a Drex `drex_noul` for the
approval, and keep only the email on the LLM."

---

## Phase 6 — Migration (only if the user approves)

Ask:

> "Would you like me to apply these changes?
> - **yes**: apply all
> - **no**: stop here; the report is saved as `nace-report.md`
> - **select**: approve each change one by one"

Do not edit any file until the user says yes or select. For each approved site:

1. Call `get_integration_template` with the site's first opportunity type, the
   provider and the language.
2. Read the whole file.
3. Apply the change:
   - Replace the call with the template's nace-sdk code, using the file's real
     variable names, never the template's placeholders.
   - Keep the old labels and output shape so callers do not change: Drex
     `choice` criteria keys are the old labels; NDI extract schemas list the
     old fields.
   - Add the setup (import and client) once per module.
   - For a decomposed call, replace it with the ordered steps, keeping any LLM
     step last.
   - Let Drex or NDI errors raise. Do not add a silent fallback to the old
     provider.
4. Confirm: "Updated `<file_path>`".

After the edits, remind the user to install `nace-sdk` and set `NACE_API_KEY`
(create a key at https://drex.nace.ai; one key covers Drex and NDI).

---

## Rules

- Never edit files without explicit approval.
- Never skip Phase 2.
- Never guess a model id or a price: write "unknown" and let the report say
  "not estimated".
- Always save the report, whether or not the user approves migration.
