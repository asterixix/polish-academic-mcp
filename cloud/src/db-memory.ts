/**
 * Minimal in-memory D1 stand-in for unit tests (not a full SQLite emulator).
 * Supports the SQL statements used by auth/oauth/quota modules.
 */

type Row = Record<string, unknown>;

export class MemoryD1 {
  users: Row[] = [];
  webauthn_credentials: Row[] = [];
  auth_challenges: Row[] = [];
  oauth_clients: Row[] = [];
  oauth_codes: Row[] = [];
  oauth_tokens: Row[] = [];
  usage_quotas: Row[] = [];
  search_threads: Row[] = [];

  prepare(sql: string) {
    const self = this;
    const bound: unknown[] = [];
    return {
      bind(...args: unknown[]) {
        bound.push(...args);
        return this;
      },
      async first<T extends Row>(): Promise<T | null> {
        const rows = self.runSelect(sql, bound);
        return (rows[0] as T) ?? null;
      },
      async all<T extends Row>(): Promise<{ results: T[] }> {
        return { results: self.runSelect(sql, bound) as T[] };
      },
      async run(): Promise<{ success: boolean }> {
        self.runMutate(sql, bound);
        return { success: true };
      },
    };
  }

  private runSelect(sql: string, bound: unknown[]): Row[] {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/FROM users WHERE id = \?/i.test(s)) {
      return this.users.filter((u) => u.id === bound[0]);
    }
    if (/FROM users WHERE email = \?/i.test(s)) {
      return this.users.filter((u) => u.email === bound[0]);
    }
    if (/FROM users WHERE orcid_id = \?/i.test(s)) {
      return this.users.filter((u) => u.orcid_id === bound[0]);
    }
    if (/FROM usage_quotas/i.test(s)) {
      return this.usage_quotas.filter(
        (q) =>
          q.subject_key === bound[0] && q.bucket_type === bound[1] && q.period_key === bound[2],
      );
    }
    if (/FROM oauth_clients WHERE client_id = \?/i.test(s)) {
      return this.oauth_clients.filter((c) => c.client_id === bound[0]);
    }
    if (/FROM oauth_codes WHERE code = \?/i.test(s)) {
      return this.oauth_codes.filter((c) => c.code === bound[0]);
    }
    if (/FROM oauth_tokens WHERE token_hash = \?/i.test(s)) {
      return this.oauth_tokens.filter((t) => t.token_hash === bound[0]);
    }
    if (/FROM oauth_tokens WHERE refresh_token_hash = \?/i.test(s)) {
      return this.oauth_tokens.filter((t) => t.refresh_token_hash === bound[0]);
    }
    if (/FROM webauthn_credentials WHERE user_id = \?/i.test(s)) {
      return this.webauthn_credentials.filter((c) => c.user_id === bound[0]);
    }
    if (/FROM webauthn_credentials WHERE id = \?/i.test(s)) {
      return this.webauthn_credentials.filter((c) => c.id === bound[0]);
    }
    if (/FROM auth_challenges WHERE challenge = \?/i.test(s)) {
      return this.auth_challenges.filter(
        (c) => c.challenge === bound[0] && c.type === bound[1],
      );
    }
    return [];
  }

  private runMutate(sql: string, bound: unknown[]): void {
    const s = sql.replace(/\s+/g, " ").trim();
    if (/INSERT INTO users/i.test(s)) {
      if (bound.length >= 4 && typeof bound[2] === "string" && String(bound[2]).startsWith("pbkdf2")) {
        this.users.push({
          id: bound[0],
          email: bound[1],
          password_hash: bound[2],
          display_name: bound[3],
          orcid_id: null,
          created_at: new Date().toISOString(),
        });
      } else if (bound.length === 3 && String(bound[1]).includes("-")) {
        // orcid insert: id, orcid_id, display_name
        this.users.push({
          id: bound[0],
          email: null,
          password_hash: null,
          orcid_id: bound[1],
          display_name: bound[2],
          created_at: new Date().toISOString(),
        });
      } else {
        this.users.push({
          id: bound[0],
          email: bound[1] ?? null,
          password_hash: null,
          orcid_id: null,
          display_name: bound[2] ?? bound[1],
          created_at: new Date().toISOString(),
        });
      }
      return;
    }
    if (/INSERT INTO usage_quotas/i.test(s)) {
      const existing = this.usage_quotas.find(
        (q) =>
          q.subject_key === bound[0] && q.bucket_type === bound[1] && q.period_key === bound[2],
      );
      const limit = Number(bound[3] ?? 999999);
      if (!existing) {
        this.usage_quotas.push({
          subject_key: bound[0],
          bucket_type: bound[1],
          period_key: bound[2],
          used_count: 1,
          updated_at: new Date().toISOString(),
        });
      } else if (Number(existing.used_count) < limit) {
        existing.used_count = Number(existing.used_count) + 1;
        existing.updated_at = new Date().toISOString();
      }
      return;
    }
    if (/INSERT INTO oauth_clients/i.test(s)) {
      this.oauth_clients.push({
        client_id: bound[0],
        client_secret: bound[1],
        client_name: bound[2],
        redirect_uris: bound[3],
        grant_types: bound[4],
        token_endpoint_auth_method: bound[5],
      });
      return;
    }
    if (/INSERT INTO oauth_codes/i.test(s)) {
      this.oauth_codes.push({
        code: bound[0],
        client_id: bound[1],
        user_id: bound[2],
        redirect_uri: bound[3],
        code_challenge: bound[4],
        code_challenge_method: bound[5],
        scope: bound[6],
        expires_at: bound[7],
        used: 0,
      });
      return;
    }
    if (/INSERT INTO oauth_tokens/i.test(s)) {
      this.oauth_tokens.push({
        token_hash: bound[0],
        refresh_token_hash: bound[1],
        client_id: bound[2],
        user_id: bound[3],
        scope: bound[4],
        expires_at: bound[5],
        refresh_expires_at: bound[6],
      });
      return;
    }
    if (/UPDATE oauth_codes SET used = 1/i.test(s)) {
      const row = this.oauth_codes.find((c) => c.code === bound[0]);
      if (row) row.used = 1;
      return;
    }
    if (/DELETE FROM oauth_tokens WHERE refresh_token_hash/i.test(s)) {
      this.oauth_tokens = this.oauth_tokens.filter((t) => t.refresh_token_hash !== bound[0]);
      return;
    }
    if (/INSERT INTO auth_challenges/i.test(s)) {
      this.auth_challenges.push({
        id: bound[0],
        user_id: bound[1],
        challenge: bound[2],
        type: bound[3],
        expires_at: bound[4],
        metadata: bound[5],
      });
      return;
    }
    if (/DELETE FROM auth_challenges WHERE id/i.test(s)) {
      this.auth_challenges = this.auth_challenges.filter((c) => c.id !== bound[0]);
      return;
    }
    if (/INSERT INTO webauthn_credentials/i.test(s)) {
      const existing = this.webauthn_credentials.find((c) => c.id === bound[0]);
      if (existing) {
        existing.public_key = bound[2];
        existing.transports = bound[3];
      } else {
        this.webauthn_credentials.push({
          id: bound[0],
          user_id: bound[1],
          public_key: bound[2],
          counter: 0,
          transports: bound[3],
        });
      }
      return;
    }
    if (/UPDATE webauthn_credentials SET counter/i.test(s)) {
      const row = this.webauthn_credentials.find((c) => c.id === bound[0]);
      if (row) row.counter = Number(row.counter) + 1;
    }
  }
}

export function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}
