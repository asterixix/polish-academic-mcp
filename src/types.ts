export interface Env {
  CACHE_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  TOKEN_REGISTRY_KV: KVNamespace;
  RATE_LIMIT_BYPASS_JWT_SECRET?: string;
  /**
   * PKCS#8 PEM (`-----BEGIN PRIVATE KEY-----`) dla podpisu access_token OAuth (RS256) + JWKS.
   * Bez tego access_token używa HS256 z `RATE_LIMIT_BYPASS_JWT_SECRET`.
   */
  OAUTH_RSA_PRIVATE_KEY_PKCS8_PEM?: string;
  /** TTL refresh_token w KV (sekundy), 60–7776000. Domyślnie 30 dni. */
  OAUTH_REFRESH_TOKEN_TTL_SECONDS?: string;
  ADMIN_PANEL_BEARER_SECRET?: string;

  /**
   * Limit `tools/call` na godzinę dla Bearer z OAuth (`/oauth/token`), wg klucza `oauth:<client_id>`.
   * Nie dotyczy gościa bez Bearer (wtedy limit po IP z `index.ts`). Liczba całkowita ≥ 1.
   */
  OAUTH_ACCESS_LIMIT_PER_HOUR?: string;
  /**
   * TTL access_token z OAuth w sekundach (domyślnie 3600). Górne ograniczenie 7 dni — dłuższe sesje Claude bez ponownego logowania.
   */
  OAUTH_ACCESS_TOKEN_TTL_SECONDS?: string;

  // Nextcloud WebDAV eval-data upload (tool-call telemetry).
  // Enable with EVAL_WEBDAV_ENABLED=true.
  EVAL_WEBDAV_ENABLED?: string;
  NEXTCLOUD_WEBDAV_BASE_URL?: string;
  NEXTCLOUD_WEBDAV_USERNAME?: string;
  NEXTCLOUD_WEBDAV_PASSWORD?: string;
  NEXTCLOUD_WEBDAV_PATH_PREFIX?: string;
  // Best-effort cap to keep uploaded JSON payload bounded.
  EVAL_WEBDAV_MAX_JSON_BYTES?: string;

  /** GUS BDL API — optional client id (higher rate limits). Sent as X-ClientId. */
  BDL_CLIENT_ID?: string;

  /**
   * Web3Forms access key (https://web3forms.com) — wstrzykiwany na /connect do wysyłki
   * wniosków z przeglądarki (darmowy plan). Odbiorcę ustaw w panelu Web3Forms (np. artur@sendyka.dev).
   */
  WEB3FORMS_ACCESS_KEY?: string;

  /** Polska Bibliografia Naukowa (PBN) API — institutional credentials. */
  PBN_APP_ID?: string;
  PBN_APP_TOKEN?: string;
  PBN_USER_TOKEN?: string;

  /**
   * D1 binding for POST `/internal/eval-log` (LLM eval ingest).
   * Create DB and apply `migrations/eval-log/*.sql`, then set `database_id` in wrangler.jsonc.
   */
  EVAL_LOG_DB?: D1Database;
  /**
   * Bearer secret for `/internal/eval-log`. When unset or empty, the route returns 503.
   */
  EVAL_LOG_INGEST_SECRET?: string;
  /** Max chars per stored text field (prompt, generated_text, metadata, export); default 200000. */
  EVAL_LOG_MAX_FIELD_CHARS?: string;
}
