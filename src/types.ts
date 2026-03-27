export interface Env {
  CACHE_KV: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  TOKEN_REGISTRY_KV: KVNamespace;
  RATE_LIMIT_BYPASS_JWT_SECRET?: string;
  ADMIN_PANEL_BEARER_SECRET?: string;
  CF_ACCOUNT_ID?: string;
  CF_GATEWAY_ID?: string;
  CF_AIG_TOKEN?: string;
  CF_AIG_MODEL_CHEAPEST?: string;
  CF_AIG_MODEL_BALANCED?: string;
  CF_AIG_MODEL_QUALITY?: string;
  MCP_SERVER_URL?: string;
  CHAT_UI_URL?: string;

  // Nextcloud WebDAV eval-data upload (tool-call telemetry).
  // Enable with EVAL_WEBDAV_ENABLED=true.
  EVAL_WEBDAV_ENABLED?: string;
  NEXTCLOUD_WEBDAV_BASE_URL?: string;
  NEXTCLOUD_WEBDAV_USERNAME?: string;
  NEXTCLOUD_WEBDAV_PASSWORD?: string;
  NEXTCLOUD_WEBDAV_PATH_PREFIX?: string;
  // Best-effort cap to keep uploaded JSON payload bounded.
  EVAL_WEBDAV_MAX_JSON_BYTES?: string;
}
