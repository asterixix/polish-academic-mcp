import type { CloudEnv } from "./env.js";

export type AdminIdentity = {
  id: string;
  email?: string | null;
};

/** Comma-separated user IDs allowed into /admin (from env/secret only — no hardcoded defaults). */
export function adminUidSet(env: CloudEnv): Set<string> {
  const fromEnv = (env.ADMIN_UIDS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(fromEnv);
}

export function adminEmailSet(env: CloudEnv): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminUser(env: CloudEnv, user: AdminIdentity | null): boolean {
  if (!user) return false;
  if (adminUidSet(env).has(user.id)) return true;
  if (user.email && adminEmailSet(env).has(user.email.toLowerCase())) return true;
  return false;
}
