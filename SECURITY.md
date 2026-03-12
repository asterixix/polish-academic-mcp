# Security Policy

## Supported Versions

Only the latest version on the `main` branch receives security fixes.
Older releases are not maintained.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

1. **GitHub Private Security Advisory** (preferred):
   Go to the repository → **Security** tab → **Advisories** → **New draft advisory**.

2. **Email**: If you cannot use the advisory form, email the maintainer at the
   address listed on their GitHub profile. Include "[polish-academic-mcp SECURITY]"
   in the subject line.

### What to include

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept code is welcome but not required).
- Which component(s) are affected (`index.ts`, `ratelimit.ts`, a specific tool, etc.).
- Your suggested fix, if you have one.

### Response timeline

| Event | Target time |
|---|---|
| Acknowledgement of your report | 48 hours |
| Initial assessment & severity rating | 5 business days |
| Patch or mitigation | 14 days for critical/high, 30 days for medium/low |
| Public disclosure | After patch is deployed; coordinated with reporter |

We appreciate responsible disclosure and will credit researchers in the security
advisory unless they prefer to remain anonymous.

---

## Scope

This project is a **read-only proxy** to public academic databases. It:
- Makes only GET/POST requests to external open APIs (no write access).
- Stores only API response text and rate-limit counters in Cloudflare KV.
- Does **not** collect, store, or transmit user data beyond the IP-based rate-limit
  counter (which expires after ~1 hour).
- Does **not** require authentication by default (no OAuth, no API keys managed).

### In scope

- Rate-limit bypass or amplification attacks
- Injection of malicious content into cached API responses that could affect LLM
  behaviour (prompt injection via cached data)
- Server-Side Request Forgery (SSRF) via tool parameters
- Information disclosure through error messages or cache poisoning
- Cloudflare Worker misconfigurations that expose secrets

### Out of scope

- Vulnerabilities in the upstream databases (report those to the respective
  maintainers: Biblioteka Nauki / ICM, RUJ / UJ, RODBuK, RePOD, dane.gov.pl).
- Denial-of-service through the Cloudflare rate limiter itself (Cloudflare's
  platform provides DDoS protection at the infrastructure level).
- Issues requiring physical access to Cloudflare infrastructure.
- Social engineering.

---

## Security Design Notes

| Concern | Mitigation |
|---|---|
| Rate limiting | Sliding-window counter keyed on `CF-Connecting-IP` (injected by Cloudflare, not spoofable). Limit: 10 tool calls / hour / IP. |
| SSRF | All outbound requests target hardcoded `const API_BASE` URLs in tool files. Tool parameters are never used to construct the hostname or scheme. |
| Prompt injection via cached data | Tool responses are raw text passed to the LLM. Operators deploying this server should be aware that cached API responses could theoretically contain adversarial content. |
| Secret management | No external API keys are managed by default. If keys are added (e.g. PBN), use `wrangler secret put` — never commit secrets to the repository. |
| Dependency supply chain | `@modelcontextprotocol/sdk` is pinned to an exact version. Run `npm audit` before each release. |
