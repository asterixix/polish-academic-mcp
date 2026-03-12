# Contributing to Polish Academic MCP

Thank you for your interest in contributing! This document explains how to report
bugs, request new database integrations, and submit code changes.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Reporting Bugs](#reporting-bugs)
- [Requesting a New Database](#requesting-a-new-database)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Be respectful, constructive, and welcoming to all contributors.

---

## Getting Started

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/<your-username>/polish-academic-mcp.git
   cd polish-academic-mcp
   npm install
   ```

2. Read [AGENTS.md](AGENTS.md) — it describes the architecture and the exact pattern
   for adding new tools. Following it ensures your PR is reviewed quickly.

3. Run the dev server to verify your environment:
   ```bash
   npm run dev
   # → http://localhost:8788/mcp
   ```

4. Verify TypeScript compiles with no errors before every commit:
   ```bash
   npx tsc --noEmit
   ```

---

## Reporting Bugs

Use the **Bug Report** issue template. Please include:
- The exact tool name and parameters you called
- The error message or unexpected behaviour
- Whether you can reproduce it locally (`npm run dev`) or only on the deployed Worker
- Your Claude Desktop / client version if applicable

---

## Requesting a New Database

Use the **Database Request** issue template. A new database integration requires:

1. **Public REST or OAI-PMH API** — the API must be publicly accessible without
   authentication for read/search operations.
2. **API documentation** — provide a link to the official API docs. If docs are
   behind a paywall or require registration, include excerpts.
3. **Access information** — if the API requires an API key or token, describe how to
   obtain one (registration link, institution requirement, etc.) and whether it is
   free.
4. **Sample request/response** — a `curl` example of at least one search endpoint
   and a trimmed sample response (redact any personal data).

Without items 1–4 it is very difficult to evaluate feasibility. Incomplete requests
will be labelled `needs-info` and may be closed after 30 days of no activity.

---

## Submitting a Pull Request

### Adding a new database tool

1. Create `src/tools/<database-slug>.ts` following the template in [AGENTS.md](AGENTS.md).
2. Register the tool(s) in `src/server.ts`.
3. Update the tools table in `README.md`.
4. Open a PR with the description matching the Database Request issue template fields
   (or link to an existing issue).

### Bug fixes

1. Create a branch named `fix/<short-description>`.
2. Write a minimal reproduction case in your PR description.
3. Fix the bug; do not refactor unrelated code in the same PR.

### General rules

- All PRs must pass `npx tsc --noEmit` with zero errors.
- Keep PRs focused — one feature or fix per PR.
- Do not add parsing of XML/JSON in tool handlers (see AGENTS.md §Architecture).
- Do not bump `@modelcontextprotocol/sdk` without a thorough compatibility check.

---

## Code Style

- TypeScript strict mode; no implicit `any`.
- ESM imports with `.js` extensions (`import ... from "./foo.js"`).
- Tool names: `{prefix}_{action}` in snake_case (e.g. `bn_search_articles`).
- Every `z.string()` parameter must have `.describe("…")`.
- Error handling: always catch inside the handler and return `isError: true`
  (see AGENTS.md for the exact pattern).
- No comments explaining what the code does — only why, when non-obvious.

---

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) spec:

```
feat(tools): add pbn_search tool for Polska Bibliografia Naukowa
fix(ratelimit): handle missing CF-Connecting-IP header gracefully
docs(readme): add mcp-remote connection instructions
chore(deps): pin @modelcontextprotocol/sdk to 1.26.0
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

---

## Questions?

Open a **Discussion** on GitHub or use the **Other** issue template.
