import type { Language, NaceType } from "./types.js";

/** The call being replaced, used to generate before_snippets. */
export interface LegacyTask {
  /** What the old prompt told the model. Plain words: no quotes or backslashes. */
  instruction: string;
  input: "text" | "file";
  /** Variable holding the text, or the path of the file. */
  inputVar: Record<Language, string>;
  /** True when the old call asked for JSON output. */
  json: boolean;
  /** Python statement reading the answer from `raw`, the model's text output. */
  readPy: string;
  /** TypeScript statement reading the answer from `raw`. */
  readTs: string;
  /** zod schema for the Vercel AI SDK's generateObject; null means generateText. */
  zodSchema: string | null;
  /** TypeScript statement reading the answer from generateObject's `object`. */
  readObject: string;
}

export interface Scenario {
  type: NaceType;
  description: string;
  task: LegacyTask;
  setup: Record<Language, string>;
  after: Record<Language, string>;
  /** Defines the input variable; used by the syntax tests and the live check. */
  fixture: Record<Language, string>;
  /** Prints the result; used by the live check. */
  livePrint: Record<Language, string>;
  notes: string[];
}

const PY_CLIENT = "nace = NaceClient()  # reads NACE_API_KEY";
const TS_CLIENT = "const nace = new NaceClient(); // reads NACE_API_KEY";

const PY_FILE_SETUP = `from nace_sdk import NaceClient\n\n${PY_CLIENT}`;
const TS_FILE_SETUP = `import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { NaceClient, workspaceFile } from "nace-sdk";

${TS_CLIENT}`;

const PY_TICKET = 'ticket_text = "I was charged twice for my March invoice."';
const TS_TICKET = 'const ticketText = "I was charged twice for my March invoice.";';
const PY_PDF = 'pdf_path = "tests/fixtures/sample-invoice.pdf"';
const TS_PDF = 'const pdfPath = "tests/fixtures/sample-invoice.pdf";';

const PY_UPLOAD = 'uploaded = nace.documents.upload(pdf_path, on_conflict="new_version")';
const TS_UPLOAD = `const uploaded = await nace.documents.upload(await openAsBlob(pdfPath), {
  file_name: basename(pdfPath),
  on_conflict: "new_version",
});`;
const PY_WAIT = `if job.status != "succeeded":
    job = nace.jobs.wait(job.job_id)  # raises if the job failed`;
const TS_WAIT = 'const job = created.status === "succeeded" ? created : await nace.jobs.wait(created.job_id);';

const fileTask = (instruction: string, json: boolean, readPy: string, readTs: string, zodSchema: string | null, readObject: string): LegacyTask => ({
  instruction,
  input: "file",
  inputVar: { python: "pdf_path", typescript: "pdfPath" },
  json,
  readPy,
  readTs,
  zodSchema,
  readObject,
});

const FILE_NOTES = [
  "For a public https URL, pass the URL string as the source and skip the upload.",
  "If you hold the bytes (for example multer's file.buffer), upload new Blob([buffer]) in TypeScript or the bytes in Python, with a file_name that keeps the extension.",
  "PDF, images (png, jpg, tiff, webp), Word, Excel, PowerPoint, HTML, email and plain text are accepted.",
  "Reuse one parse in later tools with a parse_result source so the file is not parsed and billed twice.",
];

export const SCENARIOS: Scenario[] = [
  {
    type: "drex_choice",
    description: "Replace an LLM call that picks one label from a fixed set with a Drex choice question",
    task: {
      instruction: "Classify the support ticket as billing, technical or general. Reply with JSON containing a category field.",
      input: "text",
      inputVar: { python: "ticket_text", typescript: "ticketText" },
      json: true,
      readPy: 'category = json.loads(raw)["category"]',
      readTs: "const category = JSON.parse(raw).category;",
      zodSchema: 'z.object({ category: z.enum(["billing", "technical", "general"]) })',
      readObject: "const category = object.category;",
    },
    setup: {
      python: `from nace_sdk import Choice, NaceClient\n\n${PY_CLIENT}`,
      typescript: `import { choice, NaceClient } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=ticket_text,
    questions={
        "category": Choice(
            instructions="Which team should handle this support ticket?",
            criteria={
                "billing": "Payments, invoices, refunds or pricing",
                "technical": "Bugs, errors or problems using the product",
                "general": "Anything else",
            },
        ),
    },
)
answer = result.choices["category"]
category = answer.choice  # one of the criteria keys: the old labels
confidence = answer.confidence`,
      typescript: `const { answers } = await nace.systemOne({
  state: ticketText,
  questions: {
    category: choice("Which team should handle this support ticket?", {
      billing: "Payments, invoices, refunds or pricing",
      technical: "Bugs, errors or problems using the product",
      general: "Anything else",
    }),
  },
});
const category = answers.category.choice; // "billing" | "technical" | "general"
const confidence = answers.category.confidence;`,
    },
    fixture: { python: PY_TICKET, typescript: TS_TICKET },
    livePrint: { python: "print(category, round(confidence, 3))", typescript: "console.log(category, confidence.toFixed(3));" },
    notes: [
      "Keep the old labels as the criteria keys so callers do not change.",
      "Drex reads the descriptions, not the key names: describe every label.",
      "answer.probabilities has a calibrated probability for every label; use it instead of asking the model for a confidence.",
      "Several judgments about the same state fit in one request (up to 512 questions).",
    ],
  },
  {
    type: "drex_noul",
    description: "Replace an LLM yes/no check with a Drex noul question",
    task: {
      instruction: "Decide whether the message is spam. Reply with JSON containing a boolean is_spam field.",
      input: "text",
      inputVar: { python: "message_text", typescript: "messageText" },
      json: true,
      readPy: 'is_spam = json.loads(raw)["is_spam"]',
      readTs: "const isSpam: boolean = JSON.parse(raw).is_spam;",
      zodSchema: "z.object({ is_spam: z.boolean() })",
      readObject: "const isSpam = object.is_spam;",
    },
    setup: {
      python: `from nace_sdk import NaceClient, Noul\n\n${PY_CLIENT}`,
      typescript: `import { NaceClient, noul } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=message_text,
    questions={
        "is_spam": Noul(instructions="Is this message unsolicited advertising or a scam?"),
    },
)
p_spam = result.nouls["is_spam"].noul  # probability of yes, 0 to 1
is_spam = p_spam >= 0.5  # choose the threshold from your own labeled examples`,
      typescript: `const { answers } = await nace.systemOne({
  state: messageText,
  questions: {
    is_spam: noul("Is this message unsolicited advertising or a scam?"),
  },
});
const pSpam = answers.is_spam.noul; // probability of yes, 0 to 1
const isSpam = pSpam >= 0.5; // choose the threshold from your own labeled examples`,
    },
    fixture: {
      python: 'message_text = "Congratulations! You won a free cruise. Click here to claim your prize."',
      typescript: 'const messageText = "Congratulations! You won a free cruise. Click here to claim your prize.";',
    },
    livePrint: { python: "print(round(p_spam, 3), is_spam)", typescript: "console.log(pSpam.toFixed(3), isSpam);" },
    notes: [
      "noul is the probability of yes. 0.5 is only a starting threshold; pick yours from labeled examples.",
      "When the instructions alone are ambiguous, describe both outcomes with criteria={'true': ..., 'false': ...}.",
    ],
  },
  {
    type: "drex_score",
    description: "Replace an LLM rating on a fixed scale with a Drex score question",
    task: {
      instruction: "Rate the urgency of the support ticket from 0 (not urgent) to 3 (critical). Reply with JSON containing an integer urgency field.",
      input: "text",
      inputVar: { python: "ticket_text", typescript: "ticketText" },
      json: true,
      readPy: 'urgency = int(json.loads(raw)["urgency"])',
      readTs: "const urgency = Number(JSON.parse(raw).urgency);",
      zodSchema: "z.object({ urgency: z.number().int().min(0).max(3) })",
      readObject: "const urgency = object.urgency;",
    },
    setup: {
      python: `from nace_sdk import NaceClient, Score\n\n${PY_CLIENT}`,
      typescript: `import { NaceClient, score } from "nace-sdk";\n\n${TS_CLIENT}`,
    },
    after: {
      python: `result = nace.system_one(
    state=ticket_text,
    questions={
        "urgency": Score(
            instructions="How urgent is this support ticket?",
            criteria=[
                "Not urgent: a question or request with no deadline",
                "Somewhat urgent: a problem with a workaround",
                "Urgent: the customer is blocked",
                "Critical: outage, data loss or a security issue",
            ],
        ),
    },
)
urgency = result.scores["urgency"].score  # expected level, 0 to 3; can fall between levels
urgency_level = round(urgency)`,
      typescript: `const { answers } = await nace.systemOne({
  state: ticketText,
  questions: {
    urgency: score("How urgent is this support ticket?", [
      "Not urgent: a question or request with no deadline",
      "Somewhat urgent: a problem with a workaround",
      "Urgent: the customer is blocked",
      "Critical: outage, data loss or a security issue",
    ]),
  },
});
const urgency = answers.urgency.score; // expected level, 0 to 3; can fall between levels
const urgencyLevel = Math.round(urgency);`,
    },
    fixture: {
      python: 'ticket_text = "Our whole team is locked out of the dashboard and we have a client demo in an hour."',
      typescript: 'const ticketText = "Our whole team is locked out of the dashboard and we have a client demo in an hour.";',
    },
    livePrint: { python: "print(round(urgency, 2), urgency_level)", typescript: "console.log(urgency.toFixed(2), urgencyLevel);" },
    notes: [
      "score is the expected level and can fall between levels; round it where the old code used integers.",
      "Write one concrete description per level, lowest first.",
    ],
  },
  {
    type: "ndi_parse",
    description: "Replace PDF text extraction, OCR or a 'transcribe this page' vision prompt with NDI parse",
    task: fileTask("Transcribe all text in this document.", false, "text = raw", "const text = raw;", null, ""),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.parse(uploaded.as_source(), wait_seconds=60)
${PY_WAIT}
text = job.result["document"]["markdown"]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.parse({ source: workspaceFile(uploaded), wait_seconds: 60 });
${TS_WAIT}
const text = (job.result as { document: { markdown: string } }).document.markdown;`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(text[:200])", typescript: "console.log(text.slice(0, 200));" },
    notes: [
      ...FILE_NOTES,
      'parse_mode="high" adds page verification and OCR correction at twice the credits; the default is "low".',
    ],
  },
  {
    type: "ndi_split",
    description: "Replace an LLM prompt that finds the documents inside a multi-document file with NDI split",
    task: fileTask(
      "This file contains several documents. List each one with its first page, last page and type (invoice or receipt) as JSON in a documents field.",
      true,
      'segments = json.loads(raw)["documents"]',
      "const segments = JSON.parse(raw).documents;",
      'z.object({ documents: z.array(z.object({ start_page: z.number(), end_page: z.number(), type: z.enum(["invoice", "receipt"]) })) })',
      "const segments = object.documents;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.split(
    uploaded.as_source(),
    classes=[
        {"id": "invoice", "label": "Invoice", "description": "A supplier invoice"},
        {"id": "receipt", "label": "Receipt", "description": "A payment receipt"},
    ],
    wait_seconds=60,
)
${PY_WAIT}
segments = [
    {
        "start_page": s["start_page"],
        "end_page": s["end_page"],
        "type": s["class"]["id"] if s["class"] else None,
    }
    for s in job.result["segments"]
]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.split({
  source: workspaceFile(uploaded),
  classes: [
    { id: "invoice", label: "Invoice", description: "A supplier invoice" },
    { id: "receipt", label: "Receipt", description: "A payment receipt" },
  ],
  wait_seconds: 60,
});
${TS_WAIT}
type Segment = { start_page: number; end_page: number; class: { id: string } | null };
const segments = (job.result as { segments: Segment[] }).segments.map((s) => ({
  start_page: s.start_page,
  end_page: s.end_page,
  type: s.class?.id ?? null,
}));`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(segments)", typescript: "console.log(segments);" },
    notes: [
      ...FILE_NOTES,
      "Class ids must be unique and cannot contain '/'; blank_page, unreadable_content and __ndi_unclassified are reserved.",
      'unknown_policy="force" gives every page a class when the old code never returned "unknown".',
    ],
  },
  {
    type: "ndi_classify",
    description: "Replace an LLM prompt that decides what type of document a file is with NDI classify",
    task: fileTask(
      "What type of document is this: invoice, receipt or resume? Reply with JSON containing a document_type field.",
      true,
      'document_type = json.loads(raw)["document_type"]',
      "const documentType = JSON.parse(raw).document_type;",
      'z.object({ document_type: z.enum(["invoice", "receipt", "resume"]) })',
      "const documentType = object.document_type;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.classify(
    uploaded.as_source(),
    classes=[
        {"id": "invoice", "label": "Invoice", "description": "A bill from a supplier asking for payment"},
        {"id": "receipt", "label": "Receipt", "description": "Proof that a payment was made"},
        {"id": "resume", "label": "Resume", "description": "A CV describing a person's work history"},
    ],
    unknown_policy="force_best",  # always one of the classes, like the old code
    wait_seconds=60,
)
${PY_WAIT}
best = job.result["units"][0]["labels"][0]
document_type = best["class_id"]`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.classify({
  source: workspaceFile(uploaded),
  classes: [
    { id: "invoice", label: "Invoice", description: "A bill from a supplier asking for payment" },
    { id: "receipt", label: "Receipt", description: "Proof that a payment was made" },
    { id: "resume", label: "Resume", description: "A CV describing a person's work history" },
  ],
  unknown_policy: "force_best", // always one of the classes, like the old code
  wait_seconds: 60,
});
${TS_WAIT}
type Unit = { labels: Array<{ class_id: string }> };
const documentType = (job.result as { units: Unit[] }).units[0].labels[0].class_id;`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(document_type)", typescript: "console.log(documentType);" },
    notes: [
      ...FILE_NOTES,
      'granularity="page" labels each page instead of the whole file.',
      "'other' is a reserved class id; give a catch-all class another id.",
    ],
  },
  {
    type: "ndi_extract",
    description: "Replace an LLM call that fills fields from a document with NDI extract (fields come with citations)",
    task: fileTask(
      "Extract the invoice number, invoice date and total from this invoice. Reply with JSON.",
      true,
      "data = json.loads(raw)",
      "const data = JSON.parse(raw);",
      "z.object({ invoice_number: z.string(), invoice_date: z.string(), total: z.number() })",
      "const data = object;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.extract(
    uploaded.as_source(),
    schema={
        "type": "object",
        "properties": {
            "invoice_number": {"type": "string"},
            "invoice_date": {"type": "string", "description": "ISO date, YYYY-MM-DD"},
            "total": {"type": "number"},
        },
        "required": ["invoice_number", "invoice_date", "total"],
    },
    wait_seconds=60,
)
${PY_WAIT}
data = job.result["data"]  # shaped by the schema
fields = job.result["fields"]  # per field: path, value, status, confidence, citations`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.extract({
  source: workspaceFile(uploaded),
  schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      invoice_date: { type: "string", description: "ISO date, YYYY-MM-DD" },
      total: { type: "number" },
    },
    required: ["invoice_number", "invoice_date", "total"],
  },
  wait_seconds: 60,
});
${TS_WAIT}
const result = job.result as { data: Record<string, unknown>; fields: unknown[] };
const data = result.data; // shaped by the schema
const fields = result.fields; // per field: path, value, status, confidence, citations`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: "print(data)", typescript: "console.log(data);" },
    notes: [
      ...FILE_NOTES,
      "If the old code used a zod schema, convert it with z.toJSONSchema(schema) (zod 4) or the zod-to-json-schema package (zod 3).",
      "Each entry in fields has a status (found, not_found, ambiguous), a confidence and citations to the page and text: use them instead of asking the model for confidence scores.",
      "instructions= adds guidance but cannot add fields the schema does not list.",
    ],
  },
  {
    type: "ndi_ground",
    description: "Replace code or a prompt that finds where a value appears in a document with NDI ground",
    task: fileTask(
      "On which page does the amount 1,200.50 appear? Reply with JSON containing a page field.",
      true,
      'page = json.loads(raw)["page"]',
      "const page = Number(JSON.parse(raw).page);",
      "z.object({ page: z.number().int() })",
      "const page = object.page;",
    ),
    setup: { python: PY_FILE_SETUP, typescript: TS_FILE_SETUP },
    after: {
      python: `${PY_UPLOAD}
job = nace.documents.ground(
    uploaded.as_source(),
    targets=[{"id": "total", "text": "1,200.50"}],
    wait_seconds=60,
)
${PY_WAIT}
target = job.result["targets"][0]
match = target["matches"][0] if target["matches"] else None
location = match["location"] if match else None  # page and polygons for a page_region`,
      typescript: `${TS_UPLOAD}
const created = await nace.documents.ground({
  source: workspaceFile(uploaded),
  targets: [{ id: "total", text: "1,200.50" }],
  wait_seconds: 60,
});
${TS_WAIT}
type Target = { id: string; status: string; matches: Array<{ location: unknown }> };
const target = (job.result as { targets: Target[] }).targets[0];
const location = target.matches[0]?.location ?? null; // page and polygons for a page_region`,
    },
    fixture: { python: PY_PDF, typescript: TS_PDF },
    livePrint: { python: 'print(target["status"], location)', typescript: "console.log(target.status, location);" },
    notes: [
      ...FILE_NOTES,
      "Up to 30 targets per job; each costs 5 credits on each file.",
      "Add a hint (nearby text) to a target whose quote appears more than once.",
    ],
  },
];

/** setup + fixture + after + print: a runnable program for the syntax tests and the live check. */
export function programFor(s: Scenario, language: Language): string {
  return [s.setup[language], s.fixture[language], s.after[language], s.livePrint[language]].join("\n\n") + "\n";
}
