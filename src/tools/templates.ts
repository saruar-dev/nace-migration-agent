import { SCENARIOS, type LegacyTask, type Scenario } from "./snippets.js";
import type { Language, NaceType } from "./types.js";

export interface IntegrationTemplate {
  opportunity_type: NaceType;
  provider: string;
  language: Language;
  description: string;
  dependency: "nace-sdk";
  install: string;
  env_var: "NACE_API_KEY";
  setup_snippet: string;
  before_snippet: string;
  after_snippet: string;
  notes: string[];
}

const COMMON_NOTES = [
  "nace-sdk raises on failure (NaceError and its subclasses). Decide the failure path explicitly; do not fall back to the old provider silently.",
  "One NACE_API_KEY (nace_sk_...) covers Drex and NDI. Create it at https://drex.nace.ai.",
];

function openaiPython(t: LegacyTask): string {
  const v = t.inputVar.python;
  const format = t.json ? '\n    response_format={"type": "json_object"},' : "";
  const call =
    t.input === "text"
      ? `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "${t.instruction}"},
        {"role": "user", "content": ${v}},
    ],${format}
)`
      : `with open(${v}, "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "${t.instruction}"},
                {"type": "file", "file": {"filename": "document.pdf", "file_data": "data:application/pdf;base64," + pdf_b64}},
            ],
        }
    ],${format}
)`;
  return `${call}\nraw = response.choices[0].message.content\n${t.readPy}`;
}

function anthropicPython(t: LegacyTask): string {
  const v = t.inputVar.python;
  const call =
    t.input === "text"
      ? `message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    system="${t.instruction}",
    messages=[{"role": "user", "content": ${v}}],
)`
      : `with open(${v}, "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()
message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64}},
                {"type": "text", "text": "${t.instruction}"},
            ],
        }
    ],
)`;
  return `${call}\nraw = message.content[0].text\n${t.readPy}`;
}

function openaiTypescript(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const format = t.json ? '\n  response_format: { type: "json_object" },' : "";
  const call =
    t.input === "text"
      ? `const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "${t.instruction}" },
    { role: "user", content: ${v} },
  ],${format}
});`
      : `const pdfB64 = readFileSync(${v}).toString("base64");
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "${t.instruction}" },
        { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64," + pdfB64 } },
      ],
    },
  ],${format}
});`;
  return `${call}\nconst raw = response.choices[0].message.content ?? "";\n${t.readTs}`;
}

function anthropicTypescript(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const call =
    t.input === "text"
      ? `const message = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: "${t.instruction}",
  messages: [{ role: "user", content: ${v} }],
});`
      : `const pdfB64 = readFileSync(${v}).toString("base64");
const message = await client.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfB64 } },
        { type: "text", text: "${t.instruction}" },
      ],
    },
  ],
});`;
  return `${call}\nconst first = message.content[0];\nconst raw = first.type === "text" ? first.text : "";\n${t.readTs}`;
}

function vercelAi(t: LegacyTask): string {
  const v = t.inputVar.typescript;
  const input =
    t.input === "text"
      ? `  prompt: "${t.instruction}\\n\\n" + ${v},`
      : `  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "${t.instruction}" },
        { type: "file", data: readFileSync(${v}), mediaType: "application/pdf" },
      ],
    },
  ],`;
  if (t.zodSchema === null) {
    return `const { text: raw } = await generateText({\n  model: openai("gpt-4o"),\n${input}\n});\n${t.readTs}`;
  }
  return `const { object } = await generateObject({\n  model: openai("gpt-4o"),\n  schema: ${t.zodSchema},\n${input}\n});\n${t.readObject}`;
}

const GENERATORS: Array<[provider: string, language: Language, generate: (t: LegacyTask) => string]> = [
  ["openai", "python", openaiPython],
  ["anthropic", "python", anthropicPython],
  ["openai", "typescript", openaiTypescript],
  ["anthropic", "typescript", anthropicTypescript],
  ["vercel_ai", "typescript", vercelAi],
];

/** Local libraries replaced by NDI parse. */
const PARSE_EXTRAS: Array<[provider: string, language: Language, before: string]> = [
  ["pdf_text", "python", `from pypdf import PdfReader\n\nreader = PdfReader(pdf_path)\ntext = "\\n".join(page.extract_text() or "" for page in reader.pages)`],
  [
    "pdf_text",
    "typescript",
    `import { readFileSync } from "node:fs";\nimport { PDFParse } from "pdf-parse";\n\nconst parser = new PDFParse({ data: readFileSync(pdfPath) });\nconst { text } = await parser.getText();`,
  ],
  ["local_ocr", "python", `import pytesseract\nfrom PIL import Image\n\ntext = pytesseract.image_to_string(Image.open(pdf_path))`],
  [
    "local_ocr",
    "typescript",
    `import { createWorker } from "tesseract.js";\n\nconst worker = await createWorker("eng");\nconst { data: { text } } = await worker.recognize(pdfPath);\nawait worker.terminate();`,
  ],
];

function make(s: Scenario, provider: string, language: Language, before: string): IntegrationTemplate {
  return {
    opportunity_type: s.type,
    provider,
    language,
    description: s.description,
    dependency: "nace-sdk",
    install: language === "python" ? "pip install nace-sdk  # Python 3.11+" : "npm install nace-sdk",
    env_var: "NACE_API_KEY",
    setup_snippet: s.setup[language],
    before_snippet: before,
    after_snippet: s.after[language],
    notes: [...s.notes, ...COMMON_NOTES],
  };
}

export const TEMPLATES: IntegrationTemplate[] = SCENARIOS.flatMap((s) => [
  ...GENERATORS.map(([provider, language, generate]) => make(s, provider, language, generate(s.task))),
  ...(s.type === "ndi_parse" ? PARSE_EXTRAS.map(([provider, language, before]) => make(s, provider, language, before)) : []),
]);

export function getTemplates(filters?: { opportunity_type?: NaceType; provider?: string; language?: Language }): IntegrationTemplate[] {
  return TEMPLATES.filter(
    (t) =>
      (!filters?.opportunity_type || t.opportunity_type === filters.opportunity_type) &&
      (!filters?.provider || t.provider === filters.provider.toLowerCase()) &&
      (!filters?.language || t.language === filters.language),
  );
}

export interface TemplateMatch {
  template: IntegrationTemplate;
  /** true only when type, provider and language all match */
  exact_match: boolean;
}

/** The best template for a type: exact provider, else openai in the same language, else any. */
export function getBestTemplate(type: NaceType, provider: string, language: Language): TemplateMatch | undefined {
  const wanted = provider.toLowerCase();
  const exact = TEMPLATES.find((t) => t.opportunity_type === type && t.provider === wanted && t.language === language);
  if (exact) return { template: exact, exact_match: true };
  const fallback =
    TEMPLATES.find((t) => t.opportunity_type === type && t.language === language) ??
    TEMPLATES.find((t) => t.opportunity_type === type);
  return fallback ? { template: fallback, exact_match: false } : undefined;
}
