/**
 * Server-side response extraction, charset decoding, and payload compaction.
 *
 * Keeps MCP tool outputs compact so multi-source federated searches and large
 * HTML/XML archival pages do not overflow the LLM context window.
 */

const DATA_IMAGE_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g;
const SCRIPT_STYLE_RE = /<(script|style|svg|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&ndash;": "–",
  "&mdash;": "—",
  "&laquo;": "«",
  "&raquo;": "»",
  "&bdquo;": "„",
  "&rdquo;": "”",
  "&oacute;": "ó",
  "&Oacute;": "Ó",
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
      if (entity in HTML_ENTITIES) return HTML_ENTITIES[entity];
      if (entity.startsWith("&#x") || entity.startsWith("&#X")) {
        const code = Number.parseInt(entity.slice(3, -1), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      if (entity.startsWith("&#")) {
        const code = Number.parseInt(entity.slice(2, -1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      }
      return entity;
    });
}

export function looksLikeHtml(text: string): boolean {
  const sample = text.slice(0, 2048).trimStart();
  return (
    /^<!doctype\s+html/i.test(sample) ||
    /^<html\b/i.test(sample) ||
    /<(body|table|div|article|main|ul|ol|form|p|h[1-6])\b/i.test(sample)
  );
}

export function looksLikeXml(text: string): boolean {
  const sample = text.slice(0, 1024).trimStart();
  return (
    /^<\?xml\b/i.test(sample) ||
    /^<(OAI-PMH|dataroot|ead|record|present|find|searchRetrieveResponse)\b/i.test(sample)
  );
}

/**
 * Convert raw HTML into a structured, readable plain-text representation
 * while preserving links (`text [href]`) and table/list structure.
 */
export function extractCompactHtml(html: string): string {
  let cleaned = html
    .replace(DATA_IMAGE_RE, "[base64-image]")
    .replace(SCRIPT_STYLE_RE, " ")
    .replace(COMMENT_RE, " ");

  // Preserve anchor hrefs inline so record IDs and scan links remain actionable.
  cleaned = cleaned.replace(
    /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const cleanHref = href.trim();
      if (!cleanHref || cleanHref.startsWith("javascript:") || cleanHref === "#") {
        return label;
      }
      return label ? `${label} [${cleanHref}]` : `[${cleanHref}]`;
    },
  );

  // Preserve form submit buttons used as record rows (e.g. straty.pl name="id1234" value="...").
  cleaned = cleaned.replace(
    /<input\b[^>]*?\btype\s*=\s*["']submit["'][^>]*>/gi,
    (tag) => {
      const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
      const value = tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
      if (name && value) return ` ${value} (${name}) | `;
      return value ? ` ${value} | ` : " ";
    },
  );

  // Convert structural tags to delimiters and line breaks.
  cleaned = cleaned
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<\/(tr|li|p|div|article|section|h[1-6]|dt|dd)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  cleaned = decodeHtmlEntities(cleaned);

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .replace(/(\|\s*){2,}/g, "| ")
        .replace(/^\|\s*|\s*\|$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0);

  return lines.join("\n");
}

/**
 * Compact verbose XML (OAI-PMH, Aleph X-Server, EAD) by stripping inline base64
 * and collapsing blank lines and redundant whitespace.
 */
export function extractCompactXml(xml: string): string {
  return xml
    .replace(DATA_IMAGE_RE, "[base64-image]")
    .replace(COMMENT_RE, "")
    .replace(/>\s+</g, ">\n<")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Compact JSON payloads for search fan-out by capping top-level or nested arrays
 * to `maxItems` and truncating overly long string fields.
 */
export function compactJsonForSearch(rawJson: string, maxItems: number): string {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    const compacted = pruneJsonValue(parsed, maxItems, 0);
    return JSON.stringify(compacted, null, 2);
  } catch {
    return rawJson;
  }
}

function pruneJsonValue(value: unknown, maxItems: number, depth: number): unknown {
  if (typeof value === "string") {
    const cleaned = value.replace(DATA_IMAGE_RE, "[base64-image]");
    return cleaned.length > 600 ? `${cleaned.slice(0, 600)}…` : cleaned;
  }
  if (Array.isArray(value)) {
    const limit = depth <= 2 ? maxItems : Math.min(value.length, 15);
    const sliced = value.slice(0, limit).map((item) => pruneJsonValue(item, maxItems, depth + 1));
    if (value.length > limit) {
      return {
        items: sliced,
        _truncated: `Pokazano ${limit} z ${value.length} elementów`,
      };
    }
    return sliced;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "_links" && depth > 0) continue;
      out[k] = pruneJsonValue(v, maxItems, depth + 1);
    }
    return out;
  }
  return value;
}

export interface SliceOptions {
  offset?: number;
  maxChars?: number;
  format?: "concise" | "detailed" | "raw";
  maxItems?: number;
}

/**
 * Apply format extraction (HTML/XML/JSON compaction) and character windowing
 * (`offset` + `maxChars`).
 */
export function formatAndSliceOutput(raw: string, options: SliceOptions = {}): string {
  const format = options.format ?? "concise";
  const offset = Math.max(0, options.offset ?? 0);
  const maxChars = Math.max(500, options.maxChars ?? 12_000);
  const maxItems = Math.max(1, options.maxItems ?? 10);

  let processed = raw;
  if (format !== "raw") {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      if (format === "concise") {
        processed = compactJsonForSearch(raw, maxItems);
      }
    } else if (looksLikeXml(raw)) {
      processed = extractCompactXml(raw);
    } else if (looksLikeHtml(raw)) {
      processed = extractCompactHtml(raw);
    }
  }

  if (offset === 0 && processed.length <= maxChars) {
    return processed;
  }

  const slice = processed.slice(offset, offset + maxChars);
  const nextOffset = offset + slice.length;
  const remaining = Math.max(0, processed.length - nextOffset);
  if (remaining > 0) {
    return `${slice}\n\n--- [Ucięto: wyświetlono znaki ${offset}–${nextOffset} z ${processed.length}. Wywołaj ponownie z offset=${nextOffset}, aby pobrać kolejne ${Math.min(remaining, maxChars)} znaków] ---`;
  }
  return slice;
}
