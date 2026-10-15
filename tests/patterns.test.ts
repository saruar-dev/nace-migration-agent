import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PATTERNS, LLM_FILE_INPUT_PATTERNS, getDetectionPatterns } from "../src/tools/patterns.js";
import { toJs, usesProvider } from "./helpers/match.js";

const entry = (provider: string, language: string) => {
  const e = AI_PROVIDER_PATTERNS.find((p) => p.provider === provider && p.language === language);
  if (!e) throw new Error(`no ${provider}/${language} entry`);
  return e;
};

const PY_PYPDF = 'from pypdf import PdfReader\n\nreader = PdfReader(path)\ntext = reader.pages[0].extract_text()\n';
const PY_FITZ_VARIABLE = "fitz = load_config()\ndoc = fitz.open(path)\n";
const PY_TEXTRACT = 'import boto3\n\ntextract = boto3.client("textract")\nresp = textract.analyze_expense(Document={"Bytes": data})\n';
const PY_AZURE = "from azure.ai.documentintelligence import DocumentIntelligenceClient\n";
const PY_GDOCAI = "from google.cloud import documentai\n";
const PY_TESSERACT = "import pytesseract\ntext = pytesseract.image_to_string(img)\n";
const PY_DOCLING = "from docling.document_converter import DocumentConverter\n";
const PY_RAW_HTTP = 'import requests\nr = requests.post("https://openrouter.ai/api/v1/chat/completions", json=payload)\n';
const PY_OPENAI_IMAGE = 'from openai import OpenAI\nclient = OpenAI()\nmsg = {"type": "image_url", "image_url": {"url": data_url}}\n';
const PY_BASE64_NO_LLM = "import base64\nencoded = base64.b64encode(raw)\n";
const TS_PDF_PARSE = "import { PDFParse } from 'pdf-parse';\nconst parser = new PDFParse({ data: buf });\n";
const TS_TESSERACT = "import { createWorker } from 'tesseract.js';\nconst worker = await createWorker('eng');\n";
const TS_TEXTRACT = 'import { TextractClient, AnalyzeExpenseCommand } from "@aws-sdk/client-textract";\n';
const TS_RAW_FETCH = 'await fetch("https://api.anthropic.com/v1/messages", { method: "POST" });\n';
const TS_TWILIO = "import twilio from 'twilio';\nawait client.messages.create({ to, from, body });\n";
const TS_OWN_GENERATE = "import { generateText } from './text-utils';\nconst t = generateText(seed);\n";
const TS_VERCEL_FILE = "import { generateObject } from 'ai';\nconst part = { type: 'file', data: buf, mediaType: 'application/pdf' };\n";

describe("document providers", () => {
  it("detect PDF libraries only when imported", () => {
    expect(usesProvider(entry("pdf_text", "python"), PY_PYPDF)).toBe(true);
    expect(usesProvider(entry("pdf_text", "python"), PY_FITZ_VARIABLE)).toBe(false);
    expect(usesProvider(entry("pdf_text", "typescript"), TS_PDF_PARSE)).toBe(true);
  });
  it("detect OCR and parsers", () => {
    expect(usesProvider(entry("local_ocr", "python"), PY_TESSERACT)).toBe(true);
    expect(usesProvider(entry("local_ocr", "typescript"), TS_TESSERACT)).toBe(true);
    expect(usesProvider(entry("doc_parsers", "python"), PY_DOCLING)).toBe(true);
  });
  it("detect cloud OCR, including a boto3 Textract client", () => {
    expect(usesProvider(entry("cloud_ocr", "python"), PY_TEXTRACT)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "python"), PY_AZURE)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "python"), PY_GDOCAI)).toBe(true);
    expect(usesProvider(entry("cloud_ocr", "typescript"), TS_TEXTRACT)).toBe(true);
  });
  it("are tagged as documents", () => {
    for (const provider of ["pdf_text", "local_ocr", "doc_parsers", "cloud_ocr"]) {
      expect(entry(provider, "python").kind).toBe("document");
      expect(entry(provider, "typescript").kind).toBe("document");
    }
  });
});

describe("LLM providers", () => {
  it("detect raw HTTP calls without an SDK", () => {
    const raw = entry("raw_http_llm", "any");
    expect(raw.kind).toBe("llm");
    expect(usesProvider(raw, PY_RAW_HTTP)).toBe(true);
    expect(usesProvider(raw, TS_RAW_FETCH)).toBe(true);
  });
  it("still ignore lookalikes", () => {
    expect(usesProvider(entry("anthropic", "typescript"), TS_TWILIO)).toBe(false);
    expect(usesProvider(entry("vercel_ai", "typescript"), TS_OWN_GENERATE)).toBe(false);
  });
  it("are tagged as llm", () => {
    expect(entry("openai", "python").kind).toBe("llm");
    expect(entry("vercel_ai", "typescript").kind).toBe("llm");
  });
});

describe("LLM_FILE_INPUT_PATTERNS", () => {
  const fileInputCandidate = (source: string) =>
    AI_PROVIDER_PATTERNS.some((e) => e.kind === "llm" && usesProvider(e, source)) &&
    LLM_FILE_INPUT_PATTERNS.some((p) => toJs(p).test(source));

  it("flag files or images sent to an LLM", () => {
    expect(fileInputCandidate(PY_OPENAI_IMAGE)).toBe(true);
    expect(fileInputCandidate(TS_VERCEL_FILE)).toBe(true);
  });
  it("ignore the same words in files without an LLM provider", () => {
    expect(fileInputCandidate(PY_BASE64_NO_LLM)).toBe(false);
  });
});

describe("getDetectionPatterns", () => {
  it("includes language-neutral entries", () => {
    const py = getDetectionPatterns("python");
    expect(py.some((p) => p.provider === "raw_http_llm")).toBe(true);
    expect(py.every((p) => p.language === "python" || p.language === "any")).toBe(true);
  });
});

describe("grep -E compatibility", () => {
  const all = [
    ...AI_PROVIDER_PATTERNS.flatMap((e) => [...e.import_patterns, ...e.call_patterns, ...e.strong_call_patterns]),
    ...LLM_FILE_INPUT_PATTERNS,
  ];
  it.each(all)("compiles: %s", (pattern) => {
    const r = spawnSync("grep", ["-E", "-q", "--", pattern, "/dev/null"]);
    expect(r.status).not.toBe(2);
  });
});
