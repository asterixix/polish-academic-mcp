# Security Policy

## Supported Versions

Only the latest version on the `main` branch receives security fixes.
Older releases are not maintained.

## Reporting a Vulnerability

Do not report security vulnerabilities through public GitHub issues.

Use a private GitHub security advisory or contact the maintainer through the
address listed on their GitHub profile. Include a clear description, steps to
reproduce, affected components, and any suggested fix.

## Scope

This project is a local MCP server that calls public academic and cultural
data sources. It:

- Makes only GET/POST requests to external public APIs and web endpoints.
- Caches API responses in memory at runtime only.
- Does not require OAuth or built-in rate limiting.
- Does not persist user sessions or access tokens.

### In scope

- SSRF via tool parameters
- Prompt injection in upstream responses that are passed back to the model
- Sensitive data exposure in tool output
- Dependency supply-chain issues

### Out of scope

- Vulnerabilities in the upstream databases themselves
- Issues requiring access to a client machine or local environment
- Social engineering

## Security Design Notes

| Concern | Mitigation |
| --- | --- |
| SSRF | Tool code uses hardcoded upstream hosts and does not accept arbitrary URLs. |
| Prompt injection | Tool responses are returned as raw text; downstream clients should treat them as untrusted data. |
| Secrets | Optional API credentials are sourced from environment variables only. |
| Dependencies | `@modelcontextprotocol/sdk` is pinned to a specific version. |
