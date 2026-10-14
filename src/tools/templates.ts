export type OpportunityType =
  | "compression"
  | "classification"
  | "extraction"
  | "summarization";

export interface IntegrationTemplate {
  opportunity_type: OpportunityType;
  provider: string;
  language: "python" | "typescript";
  description: string;
  /** pip/npm package to add ("" = nothing to install) */
  dependency: string;
  /** environment variable required */
  env_var: string;
  setup_snippet: string;
  before_snippet: string;
  after_snippet: string;
  notes: string[];
}

// There is no ScaleDown SDK with these calls, so every template talks to the
// HTTP API directly. The after_snippet only depends on task + language (the
// ScaleDown call replaces the provider call); only before_snippet varies by
// provider.

const PY_POST_HELPER = `SCALEDOWN_URL = "https://api.scaledown.xyz"


def scaledown_post(path, body):
    r = requests.post(
        SCALEDOWN_URL + path,
        json=body,
        headers={"x-api-key": os.environ["SCALEDOWN_API_KEY"]},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()`;

const PY_SETUP = `import os
import requests

${PY_POST_HELPER}`;

const PY_SETUP_CHAT = `import json
import os
import requests

${PY_POST_HELPER}


def scaledown_chat(model, messages, **extra):
    # extract / summarize return their result as a JSON string in the message content
    data = scaledown_post("/v1/chat/completions", {"model": model, "messages": messages, **extra})
    return json.loads(data["choices"][0]["message"]["content"])`;

const TS_SETUP = `const SCALEDOWN_URL = "https://api.scaledown.xyz";

async function scaledownPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(SCALEDOWN_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.SCALEDOWN_API_KEY!,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(\`ScaleDown \${path} failed: \${res.status} \${await res.text()}\`);
  return res.json();
}`;

const TS_SETUP_CHAT = `${TS_SETUP}

// extract / summarize return their result as a JSON string in the message content
async function scaledownChat(model: string, messages: object[], extra: object = {}): Promise<any> {
  const data = await scaledownPost("/v1/chat/completions", { model, messages, ...extra });
  return JSON.parse(data.choices[0].message.content);
}`;

const PY_DEP = "requests";
const TS_DEP = "";
const TS_DEP_NOTE =
  "No package to install: uses the built-in fetch (Node 18+). On older Node, add node-fetch.";

// ── Shared after_snippets ────────────────────────────────────────────────────

const PY_CLASSIFY_AFTER = `result = scaledown_post("/classify", {
    "text": text,
    "labels": [
        {"name": "billing",   "rubric": "Does this text describe a billing or payment issue?"},
        {"name": "technical", "rubric": "Does this text describe a technical or product issue?"},
        {"name": "general",   "rubric": "Is this a general inquiry not related to billing or technical issues?"},
    ],
    "reasoning": False,  # the default (True) roughly doubles billed input tokens
})
label = result["top_label"]  # result["scores"] has the full {label: probability} distribution`;

const PY_CLASSIFY_NOTES = [
  "Rubrics are yes/no questions — ScaleDown's SLM answers each and normalises scores.",
  'result["scores"] returns {label: probability} for all labels.',
  'Send "reasoning": False unless you read result["reasoning"]; the default bills about 2x the input tokens.',
  "Typical latency: ~50-200ms. Much faster than a frontier LLM call.",
];

// ── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: IntegrationTemplate[] = [
  // ── Python: Compression before OpenAI call ───────────────────────────────
  {
    opportunity_type: "compression",
    provider: "openai",
    language: "python",
    description:
      "Compress large context (RAG results, documents) before sending to OpenAI to reduce token cost by 50-70%",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP,
    before_snippet: `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": context + "\\n\\n" + user_query},
    ],
)`,
    after_snippet: `# Compress the context before the LLM call
compressed = scaledown_post("/compress/raw/", {
    "context": context,
    "prompt": user_query,
    "scaledown": {"rate": "auto"},
})["results"]
# compressed_prompt is the compressed *context*; the query is not folded in
small_context = compressed["compressed_prompt"] if compressed["success"] else context

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": small_context + "\\n\\n" + user_query},
    ],
)
# compressed["compression_ratio"] ≈ 0.30-0.50`,
    notes: [
      "The 'context' variable should hold the large background text (e.g. retrieved docs).",
      "The 'prompt' should be the user's query or instruction.",
      "The result is nested under 'results'. Check results['success'] and fall back to the original context if it is false.",
      "results['compressed_prompt'] is the compressed context only — keep sending the user's query alongside it.",
      "Use rate='auto' to let ScaleDown pick the compression level, or a number 0-1 (fraction of tokens to remove).",
    ],
  },
  // ── Python: Compression before Anthropic call ────────────────────────────
  {
    opportunity_type: "compression",
    provider: "anthropic",
    language: "python",
    description:
      "Compress large context before sending to Anthropic Claude to reduce token cost by 50-70%",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP,
    before_snippet: `message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": context + "\\n\\n" + user_query}
    ],
)`,
    after_snippet: `compressed = scaledown_post("/compress/raw/", {
    "context": context,
    "prompt": user_query,
    "scaledown": {"rate": "auto"},
})["results"]
small_context = compressed["compressed_prompt"] if compressed["success"] else context

message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": small_context + "\\n\\n" + user_query}
    ],
)`,
    notes: [
      "Works with any Anthropic model.",
      "The result is nested under 'results'. Check results['success'] and fall back to the original context if it is false.",
      "results['compressed_prompt'] is the compressed context only — keep sending the user's query alongside it.",
      "Pair with Anthropic prompt caching for maximum savings.",
    ],
  },
  // ── Python: Replace OpenAI classification with sd_classify ───────────────
  {
    opportunity_type: "classification",
    provider: "openai",
    language: "python",
    description:
      "Replace an OpenAI call used for text classification with sd_classify — 95% cheaper",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP,
    before_snippet: `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "system",
            "content": "Classify the following text as one of: billing, technical, general. Reply with just the label.",
        },
        {"role": "user", "content": text},
    ],
)
label = response.choices[0].message.content.strip()`,
    after_snippet: PY_CLASSIFY_AFTER,
    notes: PY_CLASSIFY_NOTES,
  },
  // ── Python: Replace Anthropic classification with sd_classify ────────────
  {
    opportunity_type: "classification",
    provider: "anthropic",
    language: "python",
    description:
      "Replace an Anthropic call used for text classification with sd_classify — 95% cheaper",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP,
    before_snippet: `message = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=10,
    system="Classify the following text as one of: billing, technical, general. Reply with just the label.",
    messages=[{"role": "user", "content": text}],
)
label = message.content[0].text.strip()`,
    after_snippet: PY_CLASSIFY_AFTER,
    notes: PY_CLASSIFY_NOTES,
  },
  // ── Python: Replace OpenAI entity extraction with sd_extract ─────────────
  {
    opportunity_type: "extraction",
    provider: "openai",
    language: "python",
    description:
      "Replace an OpenAI call used for named entity extraction with sd_extract — 95% cheaper",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP_CHAT,
    before_snippet: `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {
            "role": "system",
            "content": 'Extract all person names and email addresses from the text. Return as JSON: {"names": [...], "emails": [...]}',
        },
        {"role": "user", "content": text},
    ],
)
import json
data = json.loads(response.choices[0].message.content)`,
    after_snippet: `result = scaledown_chat(
    "extract",
    [{"role": "user", "content": text}],
    entities={
        "Name":  "Full name of a person",
        "Email": "Email address",
    },
)
# result["entities"] is a list of {"text", "type", "confidence", "start", "end", "context"}
names  = [e["text"] for e in result["entities"] if e["type"] == "Name"]
emails = [e["text"] for e in result["entities"] if e["type"] == "Email"]`,
    notes: [
      "Entity types are defined by natural-language descriptions — any names work.",
      "Read flat fields from result['entities'] grouped by 'type'. result['structured_result'] is null unless a field is a nested object or array schema.",
      "Each distinct value is returned once, up to 30 per entity type.",
      "Put a global instruction (e.g. dedup rules) in a system message.",
      "Pass threshold=0.5 or top_n=1 as extra keyword arguments to filter by confidence or count.",
    ],
  },
  // ── Python: Replace OpenAI summarization with sd_summarize ───────────────
  {
    opportunity_type: "summarization",
    provider: "openai",
    language: "python",
    description:
      "Replace an OpenAI call used for summarization with sd_summarize — 90% cheaper",
    dependency: PY_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: PY_SETUP_CHAT,
    before_snippet: `response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "Summarize the following document concisely."},
        {"role": "user", "content": long_text},
    ],
)
summary = response.choices[0].message.content`,
    after_snippet: `result = scaledown_chat(
    "summarize",
    [
        {"role": "system", "content": "Be concise."},  # optional style instructions
        {"role": "user", "content": long_text},
    ],
    max_tokens=1000,
)
summary = result["summary"]`,
    notes: [
      "sd_summarize is abstractive (rewrites, not just extracts sentences).",
      "System-message instructions extend the default behaviour (no new information, no commentary).",
      "max_tokens is capped at 1000. result['finish_reason'] == 'length' means the summary was cut off.",
    ],
  },
  // ── TypeScript: Compression before OpenAI call ───────────────────────────
  {
    opportunity_type: "compression",
    provider: "openai",
    language: "typescript",
    description:
      "Compress large context before sending to OpenAI to reduce token cost by 50-70%",
    dependency: TS_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: TS_SETUP,
    before_snippet: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user",   content: context + "\\n\\n" + userQuery },
  ],
});`,
    after_snippet: `const { results: compressed } = await scaledownPost("/compress/raw/", {
  context,
  prompt: userQuery,
  scaledown: { rate: "auto" },
});
// compressed_prompt is the compressed *context*; the query is not folded in
const smallContext = compressed.success ? compressed.compressed_prompt : context;

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user",   content: smallContext + "\\n\\n" + userQuery },
  ],
});`,
    notes: [
      TS_DEP_NOTE,
      "The result is nested under 'results'. Check results.success and fall back to the original context if it is false.",
      "results.compressed_prompt is the compressed context only — keep sending the user's query alongside it.",
      "Use rate: 'auto' or a number between 0 and 1 (fraction of tokens to remove).",
    ],
  },
  // ── TypeScript: Replace OpenAI classification with sd_classify ───────────
  {
    opportunity_type: "classification",
    provider: "openai",
    language: "typescript",
    description:
      "Replace an OpenAI call used for text classification with sd_classify — 95% cheaper",
    dependency: TS_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: TS_SETUP,
    before_snippet: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "Classify as: billing, technical, or general. Reply with just the label." },
    { role: "user",   content: text },
  ],
});
const label = response.choices[0].message.content?.trim();`,
    after_snippet: `const result = await scaledownPost("/classify", {
  text,
  labels: [
    { name: "billing",   rubric: "Does this text describe a billing or payment issue?" },
    { name: "technical", rubric: "Does this text describe a technical or product issue?" },
    { name: "general",   rubric: "Is this a general inquiry?" },
  ],
  reasoning: false, // the default (true) roughly doubles billed input tokens
});
const label: string = result.top_label;`,
    notes: [
      TS_DEP_NOTE,
      "result.scores gives the full probability distribution over labels.",
      "Send reasoning: false unless you read result.reasoning; the default bills about 2x the input tokens.",
      "Much lower latency than a frontier LLM call (~50-200ms).",
    ],
  },
  // ── TypeScript: Replace OpenAI entity extraction with sd_extract ─────────
  {
    opportunity_type: "extraction",
    provider: "openai",
    language: "typescript",
    description:
      "Replace an OpenAI call used for named entity extraction with sd_extract — 95% cheaper",
    dependency: TS_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: TS_SETUP_CHAT,
    before_snippet: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: 'Extract all person names and email addresses. Return JSON: {"names": [...], "emails": [...]}' },
    { role: "user",   content: text },
  ],
});
const data = JSON.parse(response.choices[0].message.content!);`,
    after_snippet: `const result = await scaledownChat(
  "extract",
  [{ role: "user", content: text }],
  {
    entities: {
      Name:  "Full name of a person",
      Email: "Email address",
    },
  },
);
// result.entities is a list of { text, type, confidence, start, end, context }
const names: string[]  = result.entities.filter((e: any) => e.type === "Name").map((e: any) => e.text);
const emails: string[] = result.entities.filter((e: any) => e.type === "Email").map((e: any) => e.text);`,
    notes: [
      TS_DEP_NOTE,
      "Read flat fields from result.entities grouped by type. result.structured_result is null unless a field is a nested object or array schema.",
      "Each distinct value is returned once, up to 30 per entity type.",
      "Put a global instruction (e.g. dedup rules) in a system message.",
    ],
  },
  // ── TypeScript: Replace OpenAI summarization with sd_summarize ───────────
  {
    opportunity_type: "summarization",
    provider: "openai",
    language: "typescript",
    description:
      "Replace an OpenAI call used for summarization with sd_summarize — 90% cheaper",
    dependency: TS_DEP,
    env_var: "SCALEDOWN_API_KEY",
    setup_snippet: TS_SETUP_CHAT,
    before_snippet: `const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [
    { role: "system", content: "Summarize the following document concisely." },
    { role: "user",   content: longText },
  ],
});
const summary = response.choices[0].message.content;`,
    after_snippet: `const result = await scaledownChat(
  "summarize",
  [
    { role: "system", content: "Be concise." }, // optional style instructions
    { role: "user",   content: longText },
  ],
  { max_tokens: 1000 },
);
const summary: string = result.summary;`,
    notes: [
      TS_DEP_NOTE,
      "System-message instructions extend the default behaviour (no new information, no commentary).",
      "max_tokens is capped at 1000. result.finish_reason === 'length' means the summary was cut off.",
    ],
  },
];

/** Returns all templates, optionally filtered */
export function getTemplates(filters?: {
  opportunity_type?: OpportunityType;
  provider?: string;
  language?: "python" | "typescript";
}): IntegrationTemplate[] {
  let results = TEMPLATES;
  if (filters?.opportunity_type)
    results = results.filter(
      (t) => t.opportunity_type === filters.opportunity_type
    );
  if (filters?.provider) {
    const provider = filters.provider.toLowerCase();
    results = results.filter((t) => t.provider === provider);
  }
  if (filters?.language)
    results = results.filter((t) => t.language === filters.language);
  return results;
}

export interface TemplateMatch {
  template: IntegrationTemplate;
  /** true only when task, provider and language all match */
  exact_match: boolean;
}

/**
 * Returns the best template for a task. Falls back to another provider in the
 * same language, then to the same task in the other language.
 */
export function getBestTemplate(
  opportunity_type: OpportunityType,
  provider: string,
  language: "python" | "typescript"
): TemplateMatch | undefined {
  const wanted = provider.toLowerCase();
  const exact = TEMPLATES.find(
    (t) =>
      t.opportunity_type === opportunity_type &&
      t.provider === wanted &&
      t.language === language
  );
  if (exact) return { template: exact, exact_match: true };

  const fallback =
    TEMPLATES.find(
      (t) => t.opportunity_type === opportunity_type && t.language === language
    ) ??
    TEMPLATES.find((t) => t.opportunity_type === opportunity_type);
  return fallback ? { template: fallback, exact_match: false } : undefined;
}
