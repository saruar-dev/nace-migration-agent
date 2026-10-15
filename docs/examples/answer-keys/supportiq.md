# Answer key: meryemsakin/supportiq @ 0438e7e

Written by hand before running the agent. A reported site matches a row when its
file matches and its line falls inside the row's function.

## Sites (must be reported, with this type)

| # | File | Function (lines) | Expected type | Why |
|---|---|---|---|---|
| S1 | src/services/classifier.py | TicketClassifier._call_openai (273-292; its caller classify 356-440 also matches) | drex_choice | Picks the primary category from 8 fixed categories; classify() validates it against the list. Secondary categories may appear as an Also line (drex_noul per category). |
| S2 | src/services/sentiment.py | SentimentAnalyzer._analyze_with_openai (204-224) | drex_choice | Returns positive/neutral/negative/angry; models/rule.py branches on the label. The numeric score can come from the choice probabilities. drex_score is accepted only if the reason addresses the label the rules use. |

## Stays on the LLM (must not be reported as a Drex or NDI site)

| # | File | Function | Why |
|---|---|---|---|
| K1 | src/services/rag.py | KnowledgeBase._generate_ai_response (369-437) | Generates a suggested reply. Expected in "Stays on the LLM". |
| K2 | src/services/rag.py | KnowledgeBase._get_embedding (92-104) | Embeddings. May be absent from the report or listed as staying on the LLM. |
| K3 | src/api/health.py | check_openai (42-54) | models.list health check. May be absent or listed as staying on the LLM. |

## Not counted

Rule-based fallbacks in classifier.py and sentiment.py and the keyword rules in
services/priority_scorer.py: non-LLM heuristics, out of scope.

## Cost

Default model `gpt-4-turbo-preview` (src/config.py): priced as
gpt-4-turbo-2024-04-09 with a note. A report that says "not estimated" for it
fails the cost check.
