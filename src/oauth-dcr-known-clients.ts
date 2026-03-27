/**
 * Rozszerzanie redirect_uris przy RFC 7591 DCR dla typowych klientów MCP.
 *
 * Źródła (weryfikuj przy zmianach po stronie vendora):
 * - Claude: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
 * - ChatGPT (łącze platformy konektorów — potwierdzone przez deweloperów w ruchu sieciowym): https://chatgpt.com/connector_platform_oauth_redirect
 */

function normalizeUri(uri: string): string | null {
  try {
    return new URL(uri.trim()).href;
  } catch {
    return null;
  }
}

function hostnameSet(uris: string[]): Set<string> {
  const out = new Set<string>();
  for (const u of uris) {
    try {
      out.add(new URL(u.trim()).hostname.toLowerCase());
    } catch {
      /* skip */
    }
  }
  return out;
}

type KnownProfile = {
  id: string;
  /** Dodatkowe URI dopisywane gdy wykryto klienta (zawsze https / znane schematy). */
  extraRedirectUris: string[];
  clientNamePatterns: RegExp[];
  /** Dopasowanie hosta z pola software_id (RFC 7591). */
  softwareIdHosts: string[];
  /** Dopasowanie hosta z już podanych redirect_uris (np. claude.ai w żądaniu). */
  redirectHosts: string[];
};

const KNOWN_MCP_PROFILES: KnownProfile[] = [
  {
    id: "claude",
    extraRedirectUris: [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
    ],
    clientNamePatterns: [/claude/i, /anthropic/i],
    softwareIdHosts: ["anthropic.com", "claude.ai", "claude.com"],
    redirectHosts: ["claude.ai", "claude.com"],
  },
  {
    id: "chatgpt",
    extraRedirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    clientNamePatterns: [/chatgpt/i, /\bopenai\b/i],
    softwareIdHosts: ["openai.com", "chatgpt.com"],
    redirectHosts: ["chatgpt.com", "openai.com"],
  },
];

function softwareIdHost(software_id: string | undefined): string | null {
  if (!software_id?.trim()) return null;
  try {
    return new URL(software_id.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  for (const pat of allowed) {
    const p = pat.toLowerCase();
    if (h === p || h.endsWith(`.${p}`)) return true;
  }
  return false;
}

export type DcrRegistrationHints = {
  client_name?: string;
  software_id?: string;
  redirect_uris: string[];
};

/**
 * Zwraca listę redirect_uris: najpierw z żądania (znormalizowane), potem
 * znane URI dla wykrytego profilu (np. oba hosty Claude przy pierwszym dopasowaniu).
 */
export function expandKnownMcpRedirectUris(hints: DcrRegistrationHints): {
  redirect_uris: string[];
  matchedProfiles: string[];
} {
  const matchedProfiles: string[] = [];
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const n = normalizeUri(raw);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(n);
  };

  for (const u of hints.redirect_uris) {
    if (typeof u === "string" && u.trim()) add(u);
  }

  const name = hints.client_name?.trim() ?? "";
  const swHost = softwareIdHost(hints.software_id);
  const redirHosts = hostnameSet(hints.redirect_uris);

  for (const p of KNOWN_MCP_PROFILES) {
    let hit = false;
    if (name && p.clientNamePatterns.some((re) => re.test(name))) hit = true;
    if (swHost && p.softwareIdHosts.some((h) => hostMatches(swHost, [h]))) hit = true;
    for (const rh of redirHosts) {
      if (p.redirectHosts.some((h) => hostMatches(rh, [h]))) {
        hit = true;
        break;
      }
    }
    if (hit) {
      matchedProfiles.push(p.id);
      for (const u of p.extraRedirectUris) add(u);
    }
  }

  return { redirect_uris: out, matchedProfiles };
}
