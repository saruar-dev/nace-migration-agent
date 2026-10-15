# Answer key: m-ahmedbashir/opp-agent @ ec1e787

Written by hand before running the agent. A reported site matches a row when its
file matches and its line falls inside the row's function.

## Sites (must be reported, with this type)

| # | File | Function (lines) | Expected type | Why |
|---|---|---|---|---|
| O1 | apps/backend/src/modules/extraction/extraction.service.ts | extractText (384-411) | ndi_parse | pdf-parse getText on the uploaded PDF. Before cost: local, $0. |
| O2 | apps/backend/src/modules/extraction/ocr.service.ts | OcrService.recognizeText (20-29) | ndi_parse | tesseract.js OCR of page images. Before cost: local, $0. |
| O3 | apps/backend/src/modules/extraction/extraction.service.ts | classifyDocumentType (470-487) | ndi_classify or drex_choice | generateObject picks one document type. The input is PII-masked text and images from the uploaded file. Either type passes only if the reason mentions the masking. |
| O4 | apps/backend/src/modules/extraction/extraction.service.ts | callModel (500-527) | ndi_extract | generateObject fills the document type's schema from the file's text and images; the imagePiiDetected flag belongs to the extraction. |

## Stays on the LLM

| # | File | Function | Why |
|---|---|---|---|
| K1 | apps/frontend/src/app/api/chat/route.ts | POST (93-197) | streamText chat. Expected in "Stays on the LLM". |

## Not counted

- renderPdfPagesToImages (423-443): a helper of the parse/vision path; may appear as an extra pointer, not as its own site.
- apps/frontend/__CLEANUP__/: archived code.
- Test files (*.spec.ts).

## Cost

Models in model-registry.ts: gpt-4o (priced), claude-3-5-sonnet-20241022 (not on
the price list: "not estimated"), Groq llama models (not estimated). A report that
prices claude-3-5-sonnet or a llama model fails the cost check.
