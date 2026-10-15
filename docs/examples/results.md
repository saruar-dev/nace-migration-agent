# End-to-end results

Graded against `docs/examples/answer-keys/`. Runs: `claude -p` with `--plugin-dir`, Claude Code 2.1.300, 2026-10-15.

## Round 1

| Repo | Row | Expected | Reported | Pass |
|---|---|---|---|---|
| supportiq | S1 | drex_choice | drex_choice, `src/services/classifier.py:280` | yes |
| supportiq | S2 | drex_choice | drex_choice, `src/services/sentiment.py:213` (anger as drex_noul and polarity as drex_score on Also lines) | yes |
| supportiq | K1 | stays on LLM | stays, `src/services/rag.py:427` | yes |
| supportiq | K2 | absent or stays | stays, `src/services/rag.py:96` | yes |
| supportiq | K3 | absent or stays | absent | yes |
| supportiq | cost | gpt-4-turbo-preview priced with a note | priced as gpt-4-turbo-2024-04-09, note shown | yes |
| supportiq | missed calls | none | grep finds 4 calls; all 4 reported | yes |
| opp-agent | O1 | ndi_parse | ndi_parse, `extraction.service.ts:397` | yes |
| opp-agent | O2 | ndi_parse at `ocr.service.ts` | ndi_parse, but filed twice at the callers `extraction.service.ts:166` and `:191`; files-with-calls count shows 2 instead of 3 | no |
| opp-agent | O3 | ndi_classify or drex_choice, mentions masking | ndi_classify, `extraction.service.ts:480`, masking noted; drex_choice on an Also line for pasted text | yes |
| opp-agent | O4 | ndi_extract | ndi_extract, `extraction.service.ts:514`, split into ndi_extract + drex_noul | yes |
| opp-agent | K1 | stays on LLM | stays, `route.ts:121` | yes |
| opp-agent | cost | claude-3-5-sonnet and llama not priced | default Groq llama-4-scout not estimated; claude not priced | yes |
| opp-agent | missed calls | none | grep finds 6 call lines; all covered (OCR via its callers) | yes |

Run cost: supportiq $1.95 (38 turns, 4.6 min), opp-agent $1.77 (32 turns, 4.2 min).

Harness problems in round 1, not product defects: the `Skill` tool was not in `--allowedTools`, so both runs read SKILL.md directly instead of invoking the skill; and because the clones sat inside the plugin repo, Claude Code also loaded the repo's own `.mcp.json` as a project server, which failed to start (`${CLAUDE_PLUGIN_ROOT}` is unset there). Both runs still used the plugin's MCP tools.

Fix for O2: SKILL.md boundary rule 5 and Phase 2 step 3 now say to point a finding at the provider or library call, and to split a shared helper per caller only when callers pass different prompts or act on different decisions.

## Round 2 (opp-agent only)

Run from a clone outside the plugin repo, with `Skill` allowed: the skill loaded normally and no extra MCP server appeared.

| Row | Reported | Pass |
|---|---|---|
| O2 | ndi_parse, `ocr.service.ts:23`; files-with-calls 3 | yes |
| others | as round 1 | yes |
| extra | `renderPdfPagesToImages` (`extraction.service.ts:426`) listed as its own ndi_parse site; the key counts it as part of the parse path, and listing it double-counts NDI credits | no |

Fix: SKILL.md boundary rule 8, "Pipeline steps": a call that only prepares input for another call (rendering pages to images, resizing, base64) is part of the site it feeds.

## Round 3 (opp-agent only)

| Row | Expected | Reported | Pass |
|---|---|---|---|
| O1 | ndi_parse | ndi_parse, `extraction.service.ts:397` | yes |
| O2 | ndi_parse | ndi_parse, `ocr.service.ts:23` (names both callers) | yes |
| O3 | ndi_classify or drex_choice, mentions masking | ndi_classify, `extraction.service.ts:480`, masking noted | yes |
| O4 | ndi_extract | ndi_extract, `extraction.service.ts:514` | yes |
| K1 | stays on LLM | stays, `route.ts:121` | yes |
| extra sites | none | none (4 NDI sites, 1 stays; rasterization folded into the OCR site) | yes |
| cost | claude-3-5-sonnet and llama not priced | not priced | yes |

Run cost: round 2 $1.73 (23 turns), round 3 $1.51 (21 turns).

supportiq was not rerun: rules 5 and 8 do not touch its sites (no shared helpers or pipeline steps), and round 1 passed every row.
