# polish-academic-mcp — Cloudflare

Podpakiet Workers + Static Assets (Pages) z OAuth 2.1, ORCID / email / passkey, limitami D1 oraz AI Search Mode.

Pełna instrukcja wdrożenia, sekrety i konektory Claude / ChatGPT / Perplexity:

→ **[docs/CLOUDFLARE.md](../docs/CLOUDFLARE.md)**

## Bezpieczeństwo repozytorium

- Nie commituj `.dev.vars`, `.env`, kluczy API ani haseł kont demo.
- Szablon lokalny: skopiuj `.dev.vars.example` → `.dev.vars`.
- `ADMIN_UIDS`, `ADMIN_EMAILS`, `REVIEWER_DEMO_*`, `CF_ACCOUNT_ID` i klucze LLM ustaw tylko przez `wrangler secret put` / dashboard (nie w `wrangler.jsonc`).
- Publiczny kontakt wsparcia (`artur@sendyka.dev`) w UI jest zamierzony; to nie jest sekret.

```bash
npm install
cp .dev.vars.example .dev.vars   # uzupełnij sekrety lokalnie
npm run dev      # wrangler dev
npm run deploy
```
