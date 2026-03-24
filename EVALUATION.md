# Polish Academic MCP — Evaluation Guide

This document describes the research-question-aligned evaluation framework
for the Polish Academic MCP Server.

## Research Questions

| ID | Focus | Key Variables |
|----|-------|---------------|
| **RQ1** | Architectural properties: how context is constructed and constrained when AI agents interact with institutional repository metadata | Context fill ratio, fragment omission rate, tool selection accuracy, token efficiency |
| **RQ2** | Metadata quality: hallucinations, semantic shifts, misclassifications, epistemic errors in Polish/English bibliographic metadata | Fidelity score, classification drift (UKD/KABA), diacritic errors, semantic shift score |
| **RQ3** | Professional roles: librarian epistemic responsibility in AI-assisted cataloguing, enrichment, and reference services | Attribution transparency, reasoning auditability, cataloguing completeness |
| **RQ4** | Regulatory alignment: GDPR and EU AI Act compatibility of MCP-based library integrations | PII exposure, audit trail completeness, data minimisation, AI transparency labelling |

## File Structure

```
scripts/eval/
  test-cases.ts   — RQ-tagged test cases for all 10 tools
  metrics.ts      — 17 scoring functions (RQ1-M1 … RQ4-M4)
  runner.ts       — CLI runner: connects, executes, reports
eval.config.ts    — Thresholds, server URLs, variable map
eval-results/     — JSON output (git-ignored)
```

---

## Quick Start

```bash
# 1. Start the server locally
npm run dev

# 2. In a second terminal — run all RQs
npm run eval:local

# 3. Run a single RQ
npm run eval:rq2        # hallucination / metadata quality only

# 4. Run against deployed worker
npm run eval:remote
```

---

## npm Scripts

| Script | What it runs |
|--------|-------------|
| `npm run eval` | All RQs, uses `MCP_SERVER_URL` env var or localhost |
| `npm run eval:local` | All RQs against `localhost:8787` |
| `npm run eval:remote` | All RQs against deployed worker |
| `npm run eval:rq1` | RQ1 cases only (architecture) |
| `npm run eval:rq2` | RQ2 cases only (metadata quality) |
| `npm run eval:rq3` | RQ3 cases only (professional roles) |
| `npm run eval:rq4` | RQ4 cases only (regulatory) |

---

## Metrics Reference

### RQ1 — Architectural Properties

| ID | Metric | Threshold | OTel Attribute |
|----|--------|-----------|----------------|
| RQ1-M1 | Context fill ratio | 0.10 – 0.90 | `context.metadata_ratio` |
| RQ1-M2 | Fragment omission rate | ≤ 0.30 | `fragment.omission_rate` |
| RQ1-M3 | Tool selection accuracy | = 1.0 | `mcp.selected_tool` |
| RQ1-M4 | Response latency | ≤ 5 000 ms | `mcp.tool.latency_ms` |
| RQ1-M5 | Token efficiency ratio | 0.10 – 2.00 | `llm.tokens_in/out` |

### RQ2 — Metadata Quality & Epistemic Error

| ID | Metric | Threshold | OTel Attribute |
|----|--------|-----------|----------------|
| RQ2-M1 | Hallucination / fidelity | ≥ 0.80 | `hallucination.fidelity_score` |
| RQ2-M2 | Classification drift (UKD) | ≥ 0.70 | `classification.drift_direction` |
| RQ2-M3 | Language quality (diacritics) | ≥ 0.80 | `language.diacritic_errors_count` |
| RQ2-M4 | Semantic shift | ≥ 0.70 | `semantic.subject_shift_score` |
| RQ2-M5 | Ground truth fidelity | ≥ 0.80 | response text match |

### RQ3 — Professional Roles

| ID | Metric | Threshold | OTel Attribute |
|----|--------|-----------|----------------|
| RQ3-M1 | Attribution transparency | ≥ 0.50 | `response.fields_cited_n` |
| RQ3-M2 | Reasoning auditability | ≥ 5 words | `mcp.selection_reason` |
| RQ3-M3 | Cataloguing completeness | ≥ 0.80 | `fragment.fields_returned` |

### RQ4 — Regulatory Alignment

| ID | Metric | Threshold | OTel Attribute |
|----|--------|-----------|----------------|
| RQ4-M1 | PII exposure | = 0 | response text scan |
| RQ4-M2 | Audit trail completeness | = 1.0 | 5 required OTel attrs |
| RQ4-M3 | Data minimisation | ≥ 0.80 | `source.schema_type` |
| RQ4-M4 | AI transparency (EU AI Act) | ≥ 0.60 (high-risk) | response text scan |

---

## Test Cases

### RQ1 (7 cases) — Architecture
- `RQ1-001` Single-tool context fill — Dublin Core
- `RQ1-002` Single-tool context fill — JATS full metadata
- `RQ1-003` Cross-repository multi-hop: BN → RUJ
- `RQ1-004` Boolean query — context constraint under AND/OR
- `RQ1-005` Pagination resumption token — context continuity
- `RQ1-006` Polish-language query — tokenisation overhead
- `RQ1-007` IMGW weather + academic cross-domain

### RQ2 (10 cases) — Metadata Quality
- `RQ2-001` UKD classification fidelity — exact match
- `RQ2-002` UKD classification drift — generalization
- `RQ2-003` Author name hallucination — Polish diacritics
- `RQ2-004` Abstract semantic shift — truncation
- `RQ2-005` Bilingual metadata — code-switching detection
- `RQ2-006` KABA subject heading fidelity
- `RQ2-007` DOI hallucination probe
- `RQ2-008` Publisher name semantic shift
- `RQ2-009` Date range misclassification
- `RQ2-010` Cross-language subject equivalence PL/EN

### RQ3 (6 cases) — Professional Roles
- `RQ3-001` Tool selection transparency — reasoning logged
- `RQ3-002` Metadata enrichment attribution
- `RQ3-003` Uncertainty signalling — low-confidence classification
- `RQ3-004` Reference service — source citation completeness
- `RQ3-005` Cataloguing task — MARC field completeness
- `RQ3-006` Repeated tool call — librarian workflow simulation

### RQ4 (7 cases) — Regulatory Alignment
- `RQ4-001` PII probe — author personal data in response
- `RQ4-002` Data minimisation — DC vs JATS field exposure
- `RQ4-003` Rate limit transparency — 429 response handling
- `RQ4-004` Audit trail — span attributes completeness
- `RQ4-005` EU AI Act — high-risk classification transparency
- `RQ4-006` Cross-border data flow — non-EU repository
- `RQ4-007` Consent boundary — ORCID exposure

---

## Output Example

```
════════════════════════════════════════════════════════════
  POLISH ACADEMIC MCP — EVALUATION REPORT
════════════════════════════════════════════════════════════
  Run at:       2026-03-19T14:00:00.000Z
  Server:       http://localhost:8787/mcp
  RQ filter:    ALL
  Total cases:  30
  Passed:       24 / 30 (80.0%)
  Overall score: 78.4%
════════════════════════════════════════════════════════════

  RQ1  —  6/7 passed  |  avg score: 82.1%
    Weak metrics: RQ1-M2=61%, RQ1-M5=55%

  RQ2  —  7/10 passed  |  avg score: 71.3%
    Top failures: RQ2-M2 (3x), RQ2-M3 (2x)
    Weak metrics: RQ2-M2=58%, RQ2-M3=64%, RQ2-M4=68%

  RQ3  —  5/6 passed  |  avg score: 80.0%
    Weak metrics: RQ3-M1=52%

  RQ4  —  6/7 passed  |  avg score: 85.2%
    Top failures: RQ4-M1 (1x)
════════════════════════════════════════════════════════════
  CASE DETAILS
════════════════════════════════════════════════════════════
  ✅ RQ1-001     Single-tool context fill — Dublin Core        88.2%
  ✅ RQ1-002     Single-tool context fill — JATS full metad    79.1%
  ❌ RQ2-002     UKD classification drift — generalization     54.3%  ⚠ RQ2-M2, RQ1-M3
  ...
```

---

## Adding Custom Test Cases

```typescript
// In scripts/eval/test-cases.ts — add to the appropriate RQ array
{
  id: "RQ2-011",
  name: "My custom hallucination test",
  rq: ["RQ2"],
  tool: "bn_search_articles",
  toolArgs: { metadata_format: "oai_dc", set: "physics" },
  queryLanguage: "en",
  queryType: "classification_lookup",
  metadataSchema: "DublinCore",
  requiredFields: ["subject"],
  sensitiveFields: ["subject"],
  expectedClassificationPrefix: "53",
  groundTruth: { subject: "physics" },
  description: "Tests UKD class 53 (Physics) preservation.",
}
```

---

## CI/CD Integration

```yaml
# .github/workflows/eval.yml
name: MCP Evaluation

on:
  push:
    branches: [main]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - name: Deploy preview
        run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
      - name: Run evaluation
        run: npm run eval
        env:
          MCP_SERVER_URL: ${{ secrets.STAGING_MCP_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: eval-results/
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Connection refused` | Run `npm run dev` first |
| `Tool not found` | Check tool names in `scripts/eval/test-cases.ts` match your server |
| `Span attributes missing` | Set `EVAL_MODE=true` in `wrangler.jsonc` vars |
| `PII false positives` | Adjust regex patterns in `metrics.ts → scorePiiExposure` |
| `All RQ2 scores = 0` | Hallucination metrics need `_span` envelope — enable eval mode |
