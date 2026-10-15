# nace Migration Agent

A Claude Code plugin and MCP server that scans your codebase for LLM calls and
document-processing calls, shows which ones can move to nace, estimates the
cost before and after, and migrates them with your approval.

- **Drex** for decisions about text: pick a label (`drex_choice`), answer yes or
  no (`drex_noul`), rate on a scale (`drex_score`), with calibrated
  probabilities. `drex-v2.0` is $0.06 per million input tokens; output is free.
- **NDI** for files: parse, split, classify, extract (with citations) and
  ground, billed in credits per page.

> **Privacy:** the scan runs locally. The MCP server makes no network calls and
> no code is sent to nace. Your coding agent reads the code with its own model.
> nace is only called when your migrated code runs.

## Install

From a local clone:

```bash
claude --plugin-dir ~/nace-migration-agent
```

From GitHub:

```
/plugin marketplace add saruar-dev/nace-migration-agent
/plugin install nace-migrate@nace
/reload-plugins
```

Then, in any project:

```
/nace-migrate:evaluate
```

## The report

`nace-report.md` in the project root has:

- a summary: files scanned, sites for Drex, sites for NDI, calls that stay on the
  LLM, and the estimated cost of 1,000 runs of each site today and with nace;
- the architecture overview;
- every Drex and NDI site with its location, confidence, reason and cost line;
- the calls that stay on the LLM, and why;
- split-up plans for calls that do several jobs;
- the nace API reference and setup.

Costs are estimates from token and page counts and a dated price list
(`src/tools/pricing.ts`). A model that is not on the list is reported as "not
estimated". NDI is shown in credits unless you set a price per credit:

```bash
export NACE_NDI_USD_PER_CREDIT=0.01   # your price, from the console's Models & pricing page
```

## MCP tools

| Tool | What it does |
|---|---|
| `get_ai_detection_patterns` | grep patterns for LLM providers, raw HTTP LLM calls and document pipelines |
| `get_integration_template` | before/after code with `nace-sdk` for each of the eight types |
| `generate_migration_plan` | builds the report and does the cost arithmetic |
| `save_migration_report` | writes `nace-report.md` to the project root |

## Development

```bash
npm install
npm test             # unit and server tests
npm run typecheck
npm run bundle       # rebuilds dist/index.js; commit it with any src change
NACE_API_KEY=nace_sk_... npm run live-check   # runs every after_snippet against the live API
```

## Credits

Forked from [scaledown-team/SLM_Agent](https://github.com/scaledown-team/SLM_Agent)
(MIT). See `LICENSE`.
