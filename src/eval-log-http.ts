/**
 * HTTP ingest for chat eval: POST /internal/eval-log → scoring + D1 persistence.
 * Authenticate with Authorization: Bearer <EVAL_LOG_INGEST_SECRET>.
 */

import type { Env } from "./types.js";
import { buildChatEvalExport, parseSourceRecordInput } from "./chat-eval-pipeline.js";

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function bearerAuthorized(request: Request, secret: string): boolean {
  const h = request.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return false;
  const token = h.slice(7);
  return timingSafeEqualString(token, secret);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`;
}

function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin") ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleEvalLogOptions(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function handleEvalLogPost(request: Request, env: Env): Promise<Response> {
  const secret = env.EVAL_LOG_INGEST_SECRET?.trim();
  const db = env.EVAL_LOG_DB;
  if (!secret || !db) {
    return new Response(
      JSON.stringify(
        {
          error: "eval_log_disabled",
          message:
            "Set EVAL_LOG_INGEST_SECRET and EVAL_LOG_DB (D1 binding). Apply migrations in migrations/0001_llm_eval_log.sql via wrangler d1 migrations apply.",
        },
        null,
        2,
      ),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders(request),
        },
      },
    );
  }

  if (!bearerAuthorized(request, secret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }, null, 2), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(request),
      },
    });
  }

  const maxField = Math.max(
    1024,
    Math.min(2_000_000, Number(env.EVAL_LOG_MAX_FIELD_CHARS ?? "200000") || 200_000),
  );

  let body: unknown;
  try {
    body = (await request.json()) as unknown;
  } catch {
    return jsonResponse(request, { error: "invalid_json_body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse(request, { error: "body_must_be_object" }, 400);
  }

  const o = body as Record<string, unknown>;
  const generated =
    typeof o.generated_text === "string"
      ? o.generated_text
      : typeof o.generatedText === "string"
        ? o.generatedText
        : null;
  if (!generated) {
    return jsonResponse(request, { error: "missing_generated_text" }, 400);
  }

  const parsedRecord = parseSourceRecordInput(o.source_record);
  if (!parsedRecord.ok) {
    return jsonResponse(
      request,
      { error: "invalid_source_record", message: parsedRecord.error },
      400,
    );
  }

  const eval_test_case_id =
    typeof o.eval_test_case_id === "string" ? o.eval_test_case_id : undefined;
  const mcp_client_label =
    typeof o.mcp_client_label === "string" ? o.mcp_client_label : undefined;
  const chat_session_id =
    typeof o.chat_session_id === "string" ? o.chat_session_id : undefined;
  const upstream_model_label =
    typeof o.upstream_model_label === "string" ? o.upstream_model_label : undefined;
  const prompt = typeof o.prompt === "string" ? o.prompt : undefined;
  const metadata =
    o.metadata !== undefined && o.metadata !== null && typeof o.metadata === "object" && !Array.isArray(o.metadata)
      ? o.metadata
      : undefined;

  const exportDoc = buildChatEvalExport({
    sourceRecordJson: parsedRecord.sourceRecordJson,
    record: parsedRecord.record,
    generated_text: generated,
    eval_test_case_id,
    mcp_client_label,
    chat_session_id,
    upstream_model_label,
  });

  const id = crypto.randomUUID();
  const createdAt = exportDoc.exported_at;
  const composite = exportDoc.rq_metrics?.compositeScore ?? null;
  const passed = exportDoc.rq_metrics?.passed === true ? 1 : 0;

  const promptT = prompt !== undefined ? truncate(prompt, maxField) : null;
  const generatedT = truncate(generated, maxField);
  const metadataJson =
    metadata !== undefined ? truncate(JSON.stringify(metadata), maxField) : null;
  const exportJson = truncate(JSON.stringify(exportDoc), maxField * 2);

  try {
    await db
      .prepare(
        `INSERT INTO llm_eval_log (
        id, created_at, eval_test_case_id, composite_score, passed,
        upstream_model_label, chat_session_id, mcp_client_label,
        prompt, generated_text, metadata_json, export_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        createdAt,
        eval_test_case_id ?? null,
        composite,
        passed,
        upstream_model_label ?? null,
        chat_session_id ?? null,
        mcp_client_label ?? null,
        promptT,
        generatedT,
        metadataJson,
        exportJson,
      )
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: "d1_insert_failed", message: msg }, null, 2), {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(request),
      },
    });
  }

  const full = new URL(request.url).searchParams.get("full") === "1";

  const responsePayload = {
    id,
    created_at: createdAt,
    saved: true,
    eval_test_case_id: eval_test_case_id ?? null,
    composite_score: composite,
    passed: passed === 1,
    ...(full ? { export: exportDoc } : { export_summary: { tool: exportDoc.tool, schema_version: exportDoc.schema_version } }),
  };

  return new Response(JSON.stringify(responsePayload, null, 2), {
    status: 201,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request),
    },
  });
}
