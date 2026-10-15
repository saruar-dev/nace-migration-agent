# nace Migration Plan — opp-agent

> Generated: 2026-10-15T14:01:16.289Z
> Report version: 1
> Cost figures are estimates from token and page counts, not measurements. Prices as of 2026-10-15.

## Summary

| Metric | Value |
|---|---|
| Files scanned | 232 |
| Files with AI or document calls | 3 |
| Sites that can move to Drex | 0 |
| Sites that can move to NDI | 4 |
| Calls that stay on the LLM | 1 |
| Estimated cost of 1,000 runs of each estimated site, today | $0 |
| Same, with nace | 3,000 NDI credits |
| Sites without a full estimate | 2 |

## Current AI architecture

AI and document processing live in two places. The NestJS backend (apps/backend/src/modules/extraction) runs a document-intake pipeline behind POST /extraction/upload, called from the frontend upload hook (use-extract-invoice.ts). An uploaded file (PDF, PNG/JPEG/WebP, TXT/CSV/JSON) or pasted text is turned into text: pdf-parse reads a PDF's text layer, and a scanned PDF is rendered to page images. Those images go either to a vision model ('vision' mode, the default) or to local Tesseract OCR ('local-ocr' mode, which keeps images on the server). Text is PII-masked by ComplianceService. A first Vercel AI SDK generateObject call classifies the document as invoice, receipt or resume. A second generateObject call fills that type's Zod schema from @opp/shared, with per-field confidence on a six-anchor rubric and an imagePiiDetected flag. The model comes from model-registry.ts: the default is Groq 'meta-llama/llama-4-scout-17b-16e-instruct', and users can pick llama-3.3-70b, gpt-4o or claude-3-5-sonnet and bring their own key. The Next.js frontend has a separate chat assistant (app/api/chat/route.ts) that streams Groq llama-3.3-70b-versatile with a getInvoices tool and a human-in-the-loop deleteInvoice tool; chat-view.tsx is its useChat client.

| Usage pattern | Provider | Files | Purpose |
|---|---|---|---|
| PDF text layer | pdf_text (pdf-parse) | `apps/backend/src/modules/extraction/extraction.service.ts` | Reads the text layer of uploaded PDFs before masking and extraction; also rasterizes scanned PDFs to page images (getScreenshot) for the vision or OCR fallback. |
| Local OCR | local_ocr (tesseract.js) | `apps/backend/src/modules/extraction/ocr.service.ts`, `apps/backend/src/modules/extraction/extraction.service.ts` | In local-ocr mode, OCRs uploaded images and rasterized scanned-PDF pages so their text can be PII-masked before any model sees it; the Tesseract confidence caps the model's field confidences. |
| Document-type classification | vercel_ai (Groq llama-4-scout by default) | `apps/backend/src/modules/extraction/extraction.service.ts`, `apps/backend/src/modules/extraction/document-type-registry.ts`, `apps/backend/src/modules/extraction/model-registry.ts` | generateObject picks one of invoice / receipt / resume, which selects the extraction schema and prompt. |
| Structured document extraction | vercel_ai (Groq llama-4-scout by default) | `apps/backend/src/modules/extraction/extraction.service.ts`, `apps/backend/src/modules/extraction/document-type-registry.ts`, `apps/backend/src/modules/extraction/model-registry.ts`, `packages/shared/src/schemas/invoice.schema.ts` | generateObject fills the invoice/receipt/resume schema from masked text or page images, with per-field confidence and an image-PII flag. |
| Invoice chat assistant | vercel_ai (Groq llama-3.3-70b-versatile) | `apps/frontend/src/app/api/chat/route.ts`, `apps/frontend/src/app/dashboard/chat/chat-view.tsx` | Streams a conversational assistant that answers questions about the user's invoices with a getInvoices tool and a human-approved deleteInvoice tool. |

## NDI sites

NDI reads files and bills credits per page: parse 1, split 1, classify 2, extract 3, ground 5 per target. The price per credit is not set, so NDI costs are shown in credits; set NACE_NDI_USD_PER_CREDIT to see dollars.

### NDI parse: file to text

- **Image and scanned-PDF OCR** (`apps/backend/src/modules/extraction/ocr.service.ts:23`): medium confidence, trivial (1/5). OcrService.recognizeText() runs Tesseract (eng) on an image buffer and returns its text and confidence. It does the whole job, so this is one finding at the library call. It has two callers in processFile(): line 166, for uploaded images in local-ocr mode, and line 191, for scanned-PDF pages that renderPdfPagesToImages() (line 424, pdf-parse getScreenshot) rasterized first. That rasterization is a pipeline step of this site. The code itself notes Tesseract is 'weaker on messy scans', and the confidence ceiling in capConfidenceForOcr() exists because of OCR misreads; ndi_parse in high mode reads the original image or PDF directly. Confidence is medium, not high, because local-ocr mode exists so images never leave the server before PII masking: NDI receives the original file, which defeats that mode's stated purpose unless the privacy requirement allows nace as a processor.
  - Cost per call: $0 today → 2 NDI credits with nace; per 1,000 calls $0 → 2,000 NDI credits
  - Assumptions: One uploaded image or one scanned page per document (scanned PDFs are capped at 5 rasterized pages); High parse mode because the code compensates for OCR errors (capConfidenceForOcr)
  - Notes: NDI price per credit not set (NACE_NDI_USD_PER_CREDIT); NDI shown in credits only
- **PDF text-layer extraction** (`apps/backend/src/modules/extraction/extraction.service.ts:397`): high confidence, trivial (1/5). extractText() uses pdf-parse (new PDFParse at line 392, getText at line 397) to turn an uploaded PDF into text. The text is PII-masked, sent to classification and extraction, and returned to the UI as maskedText. When the text layer is empty, processFile() falls back to rasterizing pages (renderPdfPagesToImages, line 424) and sending them to a vision model or Tesseract. One ndi_parse call handles text-layer and scanned PDFs alike and removes that branch. pdf-parse is free and local, so this moves cost up; the gain is one parser for digital and scanned PDFs. If the extraction site moves to ndi_extract on the original file, this text is only needed for the maskedText preview. Called once per PDF upload from processFile() (line 160).
  - Cost per call: $0 today → 1 NDI credits with nace; per 1,000 calls $0 → 1,000 NDI credits
  - Assumptions: Uploaded PDFs are 1 page (invoices and receipts; resumes may be 2)
  - Notes: NDI price per credit not set (NACE_NDI_USD_PER_CREDIT); NDI shown in credits only

### NDI classify: document or page type

- **Document-type classification** (`apps/backend/src/modules/extraction/extraction.service.ts:480`): high confidence, simple (2/5). classifyDocumentType() asks the model to put the uploaded document into exactly one of DOCUMENT_TYPE_KEYS (invoice, receipt, resume) via a z.enum schema. The result selects the extraction schema and prompt for callModel(), the UI card in extraction-result-card.tsx, and the ExtractionLog.documentType column. Input is the uploaded file: its text layer, OCR text, or the image / rasterized PDF pages as image blocks. That is file classification, so it maps to ndi_classify with the same three labels. Called from processFile() (line 251) only when the request has no explicit documentType; failures already fall back to 'invoice'. Privacy: the text is PII-masked today, but NDI receives the original file.
  - Cost per call: not estimated today → 2 NDI credits with nace; per 1,000 calls not estimated → 2,000 NDI credits
  - Also: drex_choice (medium): When the request is pasted text only (no file), the input is text in memory, and a drex_choice over the three labels covers that path.
  - Assumptions: Model is the default registry entry groq:llama-4-scout; Fixed prompt plus enum schema is about 85 tokens; Document is 1 page, about 600 tokens of text or one page image; Output is one enum value in a small JSON object, about 15 tokens; Pasted-text-only requests would use drex_choice at about 630 input tokens instead
  - Notes: meta-llama/llama-4-scout-17b-16e-instruct: not on the price list, not estimated; NDI price per credit not set (NACE_NDI_USD_PER_CREDIT); NDI shown in credits only

### NDI extract: fields from a file, with citations

- **Invoice / receipt / resume field extraction** (`apps/backend/src/modules/extraction/extraction.service.ts:514`): high confidence, moderate (3/5). callModel() sends the document (masked text, or the uploaded image / rasterized scanned-PDF pages as image blocks) to generateObject with a fixed Zod schema per document type (InvoiceSchema, ReceiptSchema, ResumeSchema from @opp/shared) and a fixed prompt from document-type-registry.ts. That is schema filling from a file. ndi_extract fills the same schema from the original file and returns citations; the citations can replace the self-reported six-anchor confidence rubric. Called once per upload from processFile() (line 262). Privacy: today the text is PII-masked by ComplianceService.mask() before the model, and local-ocr mode exists so images never leave the server. NDI receives the original unmasked file, so this needs sign-off against the privacy design. renderPdfPagesToImages() (line 424, pdf-parse getScreenshot) only prepares scanned-PDF pages for this call and goes away under NDI. The imagePiiDetected flag in the same response is a secondary job; see the decomposition.
  - Cost per call: not estimated today → $0.000039 + 3 NDI credits with nace; per 1,000 calls not estimated → $0.039 + 3,000 NDI credits
  - Assumptions: Model is the default registry entry groq:llama-4-scout; users can switch to llama-3.3-70b, gpt-4o or claude-3-5-sonnet per account; Fixed prompt (task + null rule + confidence rubric + field notes + image-PII check) is about 2,140 characters, roughly 535 tokens; generateObject also sends the JSON schema with field descriptions, roughly 625 tokens for the invoice schema; A typical document is 1 page, about 600 tokens of text or one page image of similar token cost; Output is about 400 tokens: 12 data fields with ~3 line items, 12 confidence values, 1 flag; Drex image-PII step: about 600 tokens of page text plus a ~50-token question; it only runs for image or scanned uploads
  - Notes: meta-llama/llama-4-scout-17b-16e-instruct: not on the price list, not estimated; NDI price per credit not set (NACE_NDI_USD_PER_CREDIT); NDI shown in credits only

## Stays on the LLM

- **Invoice chat assistant** (`apps/frontend/src/app/api/chat/route.ts:121`): Open-ended conversational assistant: streamText generates natural-language answers over invoice data and plans tool calls (getInvoices; deleteInvoice with generated invoiceNumber/vendorName/totalAmount/currency arguments, paused for human approval in components/review/delete-invoice-review.tsx). The prompt-injection gate before the model is a keyword list (isSensitivePrompt), not an LLM call. Generation and tool planning stay on the LLM.

## Split-up calls

These calls do several jobs in one prompt. Each step goes to the cheapest handler that can do it; the LLM keeps only generation.

### Invoice / receipt / resume field extraction (`apps/backend/src/modules/extraction/extraction.service.ts:514`)

moderate (3/5): Two jobs in one prompt: schema extraction with per-field confidence, plus a yes/no image-PII check; Large dynamic context: full document text or up to 5 page images; Schema varies by document type (3 registry entries)

| Step | Purpose | Handler | Notes |
|---|---|---|---|
| 1 | Fill the document-type schema (invoice / receipt / resume fields, line items, experience, etc.) from the uploaded file | NDI `ndi_extract` | Use the schema of the documentType chosen by classification, with the same field names as the @opp/shared Zod schemas so ExtractionResult.extractedData keeps its shape. Map citation presence/strength to the existing per-field confidence object. capConfidenceForOcr() no longer applies when NDI reads the file. |
| 2 | Decide whether the page image visibly shows a private individual's email, phone, IBAN or card number (imagePiiDetected) | Drex `drex_noul` | Only run when the upload was an image or a scanned PDF (the code already forces false otherwise). Ask the IMAGE_PII_CHECK question over the parsed page text. The result is stored in ExtractionLog.imagePiiDetected and shown as a warning in extraction-result-card.tsx. |

## nace API reference

**Base URL:** `https://console.nace.ai`
**Auth:** `Authorization: Bearer $NACE_API_KEY` (one `nace_sk_` key covers Drex and NDI)
**Docs:** https://drex.nace.ai/docs

### Drex: `POST /v1/systemone`

```json
{
  "model": "drex-v2.0",
  "state": "<text or any JSON>",
  "questions": {
    "category": { "type": "choice", "instructions": "Which team should handle this?", "criteria": { "billing": "Payments and invoices", "technical": "Bugs and errors" } },
    "is_spam": { "type": "noul", "instructions": "Is this unsolicited advertising?" },
    "urgency": { "type": "score", "instructions": "How urgent is it?", "criteria": ["low", "medium", "high"] }
  }
}
```

`answers.<id>` holds `choice` with `probabilities`, `noul` (the probability of yes), or `score` with `probabilities`. Billing is on `usage.input_tokens`.

### NDI: `POST /v1/documents/{parse|split|classify|extract|ground}`

Each call creates a job for one file. `source` is an https URL, a file uploaded to your workspace, or an earlier parse. Pass `wait_seconds` (up to 60) or poll `GET /v1/documents/jobs/{id}`. The SDKs handle uploads and waiting; see the templates.

## Setup

```bash
pip install nace-sdk        # Python 3.11+
npm install nace-sdk        # Node
export NACE_API_KEY="nace_sk_..."
```

Create a key at https://drex.nace.ai. One key covers Drex and NDI.

---
*Generated by nace-migration-agent at 2026-10-15T14:01:16.289Z · report v1*
