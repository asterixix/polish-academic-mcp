import type { CacheStore } from "./cache.js";

export interface Env {
  CACHE_KV: CacheStore;

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
}
