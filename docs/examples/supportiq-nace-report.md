# nace Migration Plan — supportiq

> Generated: 2026-10-15T13:51:43.986Z
> Report version: 1
> Cost figures are estimates from token and page counts, not measurements. Prices as of 2026-10-15.

## Summary

| Metric | Value |
|---|---|
| Files scanned | 44 |
| Files with AI or document calls | 3 |
| Sites that can move to Drex | 2 |
| Sites that can move to NDI | 0 |
| Calls that stay on the LLM | 2 |
| Estimated cost of 1,000 runs of each estimated site, today | $49.50 |
| Same, with nace | $0.0636 |

## Current AI architecture

SupportIQ is a FastAPI support-ticket router. Every new ticket (POST /api/v1/tickets, run inline or as a FastAPI background task; the Celery task process_ticket_task in src/workers/tasks.py repeats the same steps) goes through a five-step pipeline: OpenAI category classification (src/services/classifier.py), OpenAI sentiment analysis (src/services/sentiment.py), rule-based priority scoring (src/services/priority_scorer.py), skill and load based agent routing (src/services/router.py), and suggested replies from a Chroma or in-memory knowledge base with OpenAI embeddings plus a GPT-drafted reply (src/services/rag.py). Each of the three services builds its own AsyncOpenAI client from settings.openai_api_key and uses settings.openai_model (default gpt-4-turbo-preview) or settings.openai_embedding_model (default text-embedding-3-small). Both decision calls ask for large JSON objects with few-shot, step-by-step prompts, but the pipeline only reads primary_category, confidence and reasoning from the classifier, and sentiment, score and anger_level from the sentiment call. Tickets are Turkish or English text from the API and from Zendesk and Freshdesk webhooks. There is no document processing: no PDF library, OCR, cloud OCR or file or image input to a model. src/api/health.py only calls models.list() as a health check.

| Usage pattern | Provider | Files | Purpose |
|---|---|---|---|
| Ticket category classification | openai | `src/services/classifier.py`, `src/api/tickets.py`, `src/workers/tasks.py` | Pick one of 8 fixed categories for each ticket. The category sets priority weights (priority_scorer.py) and agent skill matching (router.py). |
| Ticket sentiment and anger | openai | `src/services/sentiment.py`, `src/api/tickets.py`, `src/workers/tasks.py` | Label sentiment (positive, neutral, negative, angry), rate polarity from -1 to 1 and rate anger from 0 to 1. Negative or angry sentiment and anger at 0.7 or above raise priority. |
| Suggested replies (RAG) | openai | `src/services/rag.py`, `src/api/tickets.py`, `src/workers/tasks.py`, `src/api/config_api.py` | Embed knowledge-base entries and tickets for similarity search, then draft a short reply with GPT when fewer than 3 knowledge-base matches are found. |

## Drex sites

Drex answers typed questions about text with calibrated probabilities. `drex-v2.0` costs $0.06 per million input tokens; output is free.

### Drex choice: one label from a fixed set

- **Ticket category** (`src/services/classifier.py:280`): high confidence, complex (4/5). Picks one of 8 fixed categories (DEFAULT_CATEGORIES); unknown labels are already coerced to general_inquiry. tickets.py and tasks.py store only primary_category, confidence and reasoning. The category drives the priority_scorer category weights and router skill matching. Drex's calibrated per-label probabilities replace the model's self-reported confidence and all_categories. classification_reasoning, shown in the frontend ticket view, would become a short probability summary instead of free text. Tickets are Turkish or English; the English label keys stay as they are.
  - Cost per call: $0.0285 today → $0.000021 with nace; per 1,000 calls $28.50 → $0.021
  - Assumptions: System prompt is about 2,800 characters, about 700 tokens (category list, 4-step analysis guide, 2 few-shot examples, rules); User prompt template with the 15-field JSON spec is about 300 tokens; Ticket body is about 200 tokens (about 800 characters); the code truncates it at 5,000 characters; Output is about 550 tokens: a step-by-step 'thinking' field, 15 JSON fields and a detailed reasoning field (max_tokens=2000); Drex input is the ticket body (200 tokens) plus the question with 8 labels and descriptions (about 150 tokens); Model is the settings default gpt-4-turbo-preview; an OPENAI_MODEL environment variable would override it; A Redis cache (1 hour TTL, keyed on the text hash) skips repeat calls; the per-call cost assumes a cache miss
  - Notes: gpt-4-turbo-preview: not on the pricing page; priced as gpt-4-turbo-2024-04-09, the listed GPT-4 Turbo snapshot
- **Ticket sentiment and anger** (`src/services/sentiment.py:213`): high confidence, complex (4/5). Picks one of 4 fixed labels (positive, neutral, negative, angry), validated against the Sentiment enum. Stored on ticket.sentiment; priority_scorer adds weight for negative and angry, and the frontend filters and charts by it. The chosen label's probability fills the confidence field that SentimentResult requires.
  - Cost per call: $0.021 today → $0.0000426 with nace; per 1,000 calls $21.00 → $0.0426
  - Also: drex_noul (high): anger_level is only used at a 0.7 threshold: analyze() forces the label to 'angry' and priority_scorer adds a high_anger factor. That is a yes/no 'is the customer angry' probability.
  - Also: drex_score (medium): score (-1 to 1) is an ordered polarity rating stored in ticket.sentiment_score and shown in the frontend. No branch reads it, so it could instead be derived from the step-1 probabilities.
  - Assumptions: System prompt is about 2,250 characters, about 570 tokens (analysis framework and 3 few-shot examples); User prompt template with the 18-field JSON spec is about 280 tokens; Ticket body is about 200 tokens; the code truncates it at 2,000 characters; Output is about 350 tokens: 18 JSON fields including key_phrases, behavioral_cues and reasoning (max_tokens=1500); Each Drex question is the ticket body (200 tokens) plus 20-50 tokens of question text; costed as three separate questions; Model is the settings default gpt-4-turbo-preview; an OPENAI_MODEL environment variable would override it
  - Notes: gpt-4-turbo-preview: not on the pricing page; priced as gpt-4-turbo-2024-04-09, the listed GPT-4 Turbo snapshot

## Stays on the LLM

- **Suggested reply draft** (`src/services/rag.py:427`): Writes a 3-4 sentence customer reply (temperature 0.7, max_tokens 500) from the ticket and up to 3 knowledge-base references, in Turkish or the ticket language. Open-ended generation stays on the LLM.
- **Knowledge-base embeddings** (`src/services/rag.py:96`): Embeds tickets, FAQs and resolved tickets with text-embedding-3-small for Chroma similarity search. Embeddings stay on the provider.

## Split-up calls

These calls do several jobs in one prompt. Each step goes to the cheapest handler that can do it; the LLM keeps only generation.

### Ticket category (`src/services/classifier.py:280`)

complex (4/5): Few-shot, step-by-step prompt that asks for about 15 JSON fields: category, secondary categories, emotional state, urgency, risk level, churn risk, escalation, hidden issues, recommended action and reasoning; Callers read only primary_category, confidence and reasoning; the ClassificationResult response schema drops the rest

| Step | Purpose | Handler | Notes |
|---|---|---|---|
| 1 | Primary category | Drex `drex_choice` | One question with the 8 existing category keys as labels and their English descriptions as criteria. The chosen label becomes primary_category, its probability becomes confidence, the distribution becomes all_categories, and reasoning becomes a one-line summary of the top labels. Drop thinking, secondary_categories, customer_intent, emotional_state, urgency, risk_level, churn_risk, escalation_needed, hidden_issues and recommended_action: no caller reads them. |

### Ticket sentiment and anger (`src/services/sentiment.py:213`)

complex (4/5): Few-shot prompt that asks for 18 JSON fields: sentiment, score, confidence, anger, satisfaction, hidden anger, passive aggression, threats, crisis potential, intensity, frustration, churn, key phrases, behavioral cues, recommended tone and reasoning; Three typed decisions in one call; Callers read only sentiment, score and anger_level (plus confidence through SentimentResult)

| Step | Purpose | Handler | Notes |
|---|---|---|---|
| 1 | Sentiment label | Drex `drex_choice` | 4 labels: positive, neutral, negative, angry. The chosen label becomes sentiment and its probability becomes confidence. |
| 2 | Anger | Drex `drex_noul` | Ask 'Is the customer angry or hostile?'. The probability becomes anger_level, which keeps the existing 0.7 override to 'angry' and the high_anger priority factor. |
| 3 | Polarity score | Drex `drex_score` | 5-level rubric from very negative to very positive, mapped to -1..1 as score. Steps 1-3 can go as several questions in one Drex request. Drop the other 14 fields: no caller reads them. |

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
*Generated by nace-migration-agent at 2026-10-15T13:51:43.986Z · report v1*
