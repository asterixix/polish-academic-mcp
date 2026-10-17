import type { CloudEnv } from "./env.js";
import { publicOrigin } from "./env.js";
import { resolveBearerUser, mcpUnauthorized } from "./oauth.js";
import {
  consumeQuota,
  getQuota,
  resolveMcpLimit,
  mcpSubject,
  monthPeriodKey,
  nextMonthResetMessage,
} from "./quota.js";
import { jsonResponse } from "./crypto-util.js";
import {
  callMcpTool,
  handleMcpJsonRpc,
  listMcpTools,
  modeFromRequest,
  sourcesFromRequest,
} from "./tool-bridge.js";
import { appName } from "./env.js";
import { withDeveloperContact } from "./error-contact.js";
import { logActivity, purgeExpiredActivityLogs } from "./activity-log.js";



const SSE_SESSIONS = new Map<
  string,
  { createdAt: number; controller?: ReadableStreamDefaultController<Uint8Array> }
>();

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "access-control-allow-origin": request.headers.get("origin") ?? "*",
    "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, accept",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
  });
  return headers;
}

function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  cors.forEach((v, k) => headers.set(k, v));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function requireMcpAuth(
  request: Request,
  env: CloudEnv,
): Promise<{ userId: string } | Response> {
  const auth = await resolveBearerUser(env, request);
  if (!auth) return mcpUnauthorized(publicOrigin(request, env));
  return { userId: auth.user.id };
}

export async function handleMcpRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (
    request.method === "OPTIONS" &&
    (path === "/mcp" ||
      path.startsWith("/mcp") ||
      path === "/sse" ||
      path === "/messages" ||
      path === "/openapi.json" ||
      path === "/server.json" ||
      path.startsWith("/.well-known/") ||
      path.startsWith("/api/"))
  ) {
    return withCors(request, new Response(null, { status: 204 }));
  }

  if (path === "/openapi.json" && request.method === "GET") {
    const origin = publicOrigin(request, env);
    return withCors(
      request,
      jsonResponse({
        openapi: "3.1.0",
        info: {
          title: appName(env),
          version: "1.3.0",
          description:
            "Polish Academic — ujednolicony dostęp w trybie tylko do odczytu (read-only) do 55 polskich baz naukowych, prawnych, statystycznych, normalizacyjnych i kulturowych (Biblioteka Nauki, Polska Platforma Medyczna, GUS BDL, ISAP, SAOS, Wolne Lektury, Szukaj w Archiwach i inne) przez 3 skonsolidowane narzędzia MCP (list_sources, search, get_record).",
          contact: {
            name: "Artur Sendyka",
            url: "https://pamcp.pl",
            email: "artur@sendyka.dev",
          },
        },
        externalDocs: {
          description: "Dokumentacja API konektora i docelowych API źródłowych (Target API Docs)",
          url: `${origin}/connectors`,
        },
        servers: [{ url: origin }],
        paths: {
          "/mcp": {
            post: {
              operationId: "mcp",
              summary: "MCP Streamable HTTP endpoint (3 narzędzia: list_sources, search, get_record)",
              security: [{ oauth2: ["mcp"] }],
            },
          },
          "/api/search": {
            post: {
              operationId: "search",
              summary: "ChatGPT Deep Research compatible search alias (read-only)",
              security: [{ oauth2: ["mcp"] }],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { query: { type: "string", description: "Fraza wyszukiwania w polskich bazach." } },
                      required: ["query"],
                    },
                  },
                },
              },
            },
          },
          "/api/fetch": {
            post: {
              operationId: "fetch",
              summary: "ChatGPT Deep Research compatible fetch alias (read-only)",
              security: [{ oauth2: ["mcp"] }],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { id: { type: "string", description: "Identyfikator rekordu w formacie źródło:id lub URL." } },
                      required: ["id"],
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          securitySchemes: {
            oauth2: {
              type: "oauth2",
              flows: {
                authorizationCode: {
                  authorizationUrl: `${origin}/oauth/authorize`,
                  tokenUrl: `${origin}/oauth/token`,
                  scopes: { mcp: "Read-only access to Polish Academic MCP tools" },
                },
              },
            },
          },
        },
      }),
    );
  }

  if (path === "/.well-known/ai-plugin.json" && request.method === "GET") {
    const origin = publicOrigin(request, env);
    return withCors(
      request,
      jsonResponse({
        schema_version: "v1",
        name_for_human: appName(env),
        name_for_model: "polish_academic",
        description_for_human:
          "Wyszukiwanie w 55 polskich bazach naukowych, prawnych, statystycznych i kulturowych (Biblioteka Nauki, PPM, GUS, ISAP, SAOS, Archiwa Państwowe).",
        description_for_model:
          "Search 52 Polish academic, medical, legal, statistical, standard, and cultural databases via 3 read-only tools (list_sources, search, get_record). Target API docs: https://pamcp.pl/connectors",
        auth: { type: "oauth", instructions: `Use OAuth 2.1 with PKCE at ${origin}` },
        api: { type: "openapi", url: `${origin}/openapi.json` },
        logo_url: `${origin}/logo.jpg`,
        contact_email: "artur@sendyka.dev",
        legal_info_url: `${origin}/terms`,
      }),
    );
  }

  if ((path === "/.well-known/mcp.json" || path === "/server.json") && request.method === "GET") {
    const origin = publicOrigin(request, env);
    const tools = await listMcpTools(env, undefined, "router");
    return withCors(
      request,
      jsonResponse({
        $schema: "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
        name: "pl.pamcp/polish-academic",
        title: "Polish Academic",
        description:
          "Read-only MCP connector for 52 Polish scientific, medical, legal (ISAP, SAOS), statistical (GUS BDL), standards (PKN), and archival databases via 3 unified tools (list_sources, search, get_record).",
        version: "1.3.0",
        websiteUrl: origin,
        documentationUrl: `${origin}/connectors`,
        privacyPolicyUrl: `${origin}/privacy`,
        termsOfServiceUrl: `${origin}/terms`,
        repository: {
          url: "https://github.com/asterixix/polish-academic-mcp",
          source: "github",
        },
        icons: [
          { src: `${origin}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
          { src: `${origin}/apple-touch-icon.png`, mimeType: "image/png", sizes: ["180x180"] },
          { src: `${origin}/favicon-32.png`, mimeType: "image/png", sizes: ["32x32"] },
        ],
        remotes: [
          {
            type: "streamable-http",
            url: `${origin}/mcp`,
          },
        ],
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        })),
      }),
    );
  }

  // ChatGPT Deep Research aliases (require OAuth + count toward MCP quota)
  if (path === "/api/search" && request.method === "POST") {
    const auth = await requireMcpAuth(request, env);
    if (auth instanceof Response) return withCors(request, auth);
    const before = await getQuota(
      env,
      mcpSubject(auth.userId),
      "mcp_monthly",
      monthPeriodKey(),
      await resolveMcpLimit(env, auth.userId),
    );
        if (!before.allowed) {
          return withCors(
            request,
            jsonResponse(
              {
                error: withDeveloperContact(
                  `Osiągnięto limit konta (${before.limit} zapytań/miesiąc). Odnowienie limitu: ${nextMonthResetMessage(before.periodKey)}. Informacje o koncie: ${publicOrigin(request, env)}/account`,
                ),
              },
              { status: 429 },
            ),
          );
        }
    const _status = await consumeQuota(
      env,
      mcpSubject(auth.userId),
      "mcp_monthly",
      monthPeriodKey(),
      await resolveMcpLimit(env, auth.userId),
    );
    void _status;
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = body.query?.trim() ?? "";
    const mode = modeFromRequest(request);
    const result =
      mode === "router"
        ? await callMcpTool(env, "search", { query, category: "nauka" }, undefined, mode)
        : await callMcpTool(env, "bn_search_publications", { query, page: 1 }, undefined, mode);
    return withCors(request, jsonResponse({ results: result.content }));
  }

  if (path === "/api/fetch" && request.method === "POST") {
    const auth = await requireMcpAuth(request, env);
    if (auth instanceof Response) return withCors(request, auth);
    const before = await getQuota(
      env,
      mcpSubject(auth.userId),
      "mcp_monthly",
      monthPeriodKey(),
      await resolveMcpLimit(env, auth.userId),
    );
        if (!before.allowed) {
          return withCors(
            request,
            jsonResponse(
              {
                error: withDeveloperContact(
                  `Osiągnięto limit konta (${before.limit} zapytań/miesiąc). Odnowienie limitu: ${nextMonthResetMessage(before.periodKey)}. Informacje o koncie: ${publicOrigin(request, env)}/account`,
                ),
              },
              { status: 429 },
            ),
          );
        }
    const _status = await consumeQuota(
      env,
      mcpSubject(auth.userId),
      "mcp_monthly",
      monthPeriodKey(),
      await resolveMcpLimit(env, auth.userId),
    );
    void _status;
    const body = (await request.json().catch(() => ({}))) as { id?: string };
    const id = body.id?.trim() ?? "";
    // id format: tool:argJson, source:id (router), or bare article id for bn_get_article
    const mode = modeFromRequest(request);
    let result;
    if (mode === "router") {
      result = await callMcpTool(env, "get_record", { id }, undefined, mode);
    } else if (id.includes(":")) {
      const [tool, ...rest] = id.split(":");
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(rest.join(":")) as Record<string, unknown>;
      } catch {
        args = { id: rest.join(":") };
      }
      result = await callMcpTool(env, tool, args, undefined, mode);
    } else {
      result = await callMcpTool(env, "bn_get_article", { id }, undefined, mode);
    }
    return withCors(request, jsonResponse({ content: result.content }));
  }

  if (path === "/mcp" || path === "/mcp/") {
    if (request.method === "DELETE") {
      return withCors(request, new Response(null, { status: 204 }));
    }

    if (request.method === "GET") {
      const auth = await requireMcpAuth(request, env);
      if (auth instanceof Response) return withCors(request, auth);

      // SSE stream keepalive for Streamable HTTP
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(": connected\n\n"));
          const t = setInterval(() => {
            try {
              controller.enqueue(enc.encode(": ping\n\n"));
            } catch {
              clearInterval(t);
            }
          }, 25_000);
        },
      });
      return withCors(
        request,
        new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        }),
      );
    }

    if (request.method === "POST") {
      const auth = await requireMcpAuth(request, env);
      if (auth instanceof Response) return withCors(request, auth);

      const sources = sourcesFromRequest(request);
      const mode = modeFromRequest(request);
      const raw = await request.json().catch(() => null);
      if (!raw || typeof raw !== "object") {
        return withCors(request, jsonResponse({ error: "Invalid JSON-RPC body" }, { status: 400 }));
      }

      const messages = Array.isArray(raw) ? raw : [raw];
      const responses: Record<string, unknown>[] = [];

      for (const message of messages) {
        const msg = message as Record<string, unknown>;
        const method = String(msg.method ?? "");

        if (method === "tools/call") {
          const before = await getQuota(
            env,
            mcpSubject(auth.userId),
            "mcp_monthly",
            monthPeriodKey(),
            await resolveMcpLimit(env, auth.userId),
          );
          if (!before.allowed) {
            const reset = nextMonthResetMessage(before.periodKey);
            responses.push({
              jsonrpc: "2.0",
              id: msg.id ?? null,
              result: {
                content: [
                  {
                    type: "text",
                    text: withDeveloperContact(
                      `Funkcja niedostępna w ramach bieżącego przydziału konta (${before.limit} zapytań/miesiąc). Przydział odnawia się automatycznie ${reset}. Informacje o uprawnieniach konta: ${publicOrigin(request, env)}/account`,
                    ),
                  },
                ],
                isError: true,
              },
            });
            continue;
          }
          await consumeQuota(
            env,
            mcpSubject(auth.userId),
            "mcp_monthly",
            monthPeriodKey(),
            await resolveMcpLimit(env, auth.userId),
          );
        }

        const response = await handleMcpJsonRpc(env, msg, sources, mode);
        if (response) responses.push(response);

        if (method === "tools/call" && response) {
          const params = (msg.params ?? {}) as Record<string, unknown>;
          const toolName = String(params.name ?? "unknown");
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const resultObj = response.result as
            | { isError?: boolean; content?: Array<{ text?: string }> }
            | undefined;
          const isErr = Boolean(resultObj?.isError);
          const preview =
            resultObj?.content?.map((c) => c.text || "").join("\n").slice(0, 200) || "";
          void logActivity(env, {
            eventType: "mcp_tools_call",
            subjectKind: "user",
            userId: auth.userId,
            path,
            summary: `${toolName}: ${JSON.stringify(args).slice(0, 180)}`,
            status: isErr
              ? "error"
              : /"items"\s*:\s*\[\s*\]|items":\[\]/i.test(preview)
                ? "empty"
                : "ok",
            meta: {
              tool: toolName,
              mode,
              is_error: isErr,
              response_preview_chars: preview.length,
            },
          });
        }
      }

      void purgeExpiredActivityLogs(env);

      const sessionId = request.headers.get("mcp-session-id") ?? crypto.randomUUID();
      if (responses.length === 0) {
        return withCors(
          request,
          new Response(null, {
            status: 202,
            headers: { "mcp-session-id": sessionId },
          }),
        );
      }
      const body = Array.isArray(raw) ? responses : responses[0];
      const headers = new Headers({
        "content-type": "application/json",
        "mcp-session-id": sessionId,
      });
      return withCors(request, new Response(JSON.stringify(body), { status: 200, headers }));
    }
  }

  // Legacy SSE transport
  if (path === "/sse" && request.method === "GET") {
    const auth = await requireMcpAuth(request, env);
    if (auth instanceof Response) return withCors(request, auth);
    const sessionId = crypto.randomUUID();
    const origin = publicOrigin(request, env);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        SSE_SESSIONS.set(sessionId, { createdAt: Date.now(), controller });
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(`event: endpoint\ndata: ${origin}/messages?sessionId=${sessionId}\n\n`),
        );
      },
      cancel() {
        SSE_SESSIONS.delete(sessionId);
      },
    });
    return withCors(
      request,
      new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "mcp-session-id": sessionId,
        },
      }),
    );
  }

  if (path === "/messages" && request.method === "POST") {
    const auth = await requireMcpAuth(request, env);
    if (auth instanceof Response) return withCors(request, auth);
    const sources = sourcesFromRequest(request);
    const mode = modeFromRequest(request);
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw) return withCors(request, jsonResponse({ error: "Invalid JSON" }, { status: 400 }));

    if (String(raw.method ?? "") === "tools/call") {
      const before = await getQuota(
        env,
        mcpSubject(auth.userId),
        "mcp_monthly",
        monthPeriodKey(),
        await resolveMcpLimit(env, auth.userId),
      );
      if (!before.allowed) {
        const quotaErr = {
          jsonrpc: "2.0",
          id: raw.id ?? null,
          result: {
            content: [
              {
                type: "text",
                text: withDeveloperContact(
                  `Limit miesięczny MCP wyczerpany (${before.limit}/miesiąc). Informacje o koncie: ${publicOrigin(request, env)}/account`,
                ),
              },
            ],
            isError: true,
          },
        };
        const sseSession = SSE_SESSIONS.get(sessionId);
        if (sseSession?.controller) {
          try {
            sseSession.controller.enqueue(
              new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(quotaErr)}\n\n`),
            );
          } catch {
            SSE_SESSIONS.delete(sessionId);
          }
        }
        return withCors(request, jsonResponse(quotaErr));
      }
      await consumeQuota(
        env,
        mcpSubject(auth.userId),
        "mcp_monthly",
        monthPeriodKey(),
        await resolveMcpLimit(env, auth.userId),
      );
    }

    const response = await handleMcpJsonRpc(env, raw, sources, mode);
    if (!response) return withCors(request, new Response(null, { status: 202 }));
    const sseSession = SSE_SESSIONS.get(sessionId);
    if (sseSession?.controller) {
      try {
        sseSession.controller.enqueue(
          new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(response)}\n\n`),
        );
      } catch {
        SSE_SESSIONS.delete(sessionId);
      }
    }
    return withCors(request, jsonResponse(response));
  }

    // Directory Compliance & Submission Metadata endpoint
    if (path === "/api/directory-metadata" && request.method === "GET") {
      const origin = publicOrigin(request, env);
      const routerTools = await listMcpTools(env, undefined, "router");
      const granularTools = await listMcpTools(env, undefined, "granular");
      return withCors(
        request,
        jsonResponse({
          name: "Polish Academic MCP",
          slug: "polish-academic-mcp",
          version: "1.3.0",
          one_liner:
            "Przeszukuj 55 polskich baz naukowe, medyczne (PPM), prawne (ISAP, SAOS), statystyczne (GUS BDL) i archiwalne.",
          description:
            "Polish Academic MCP udostępnia ujednolicony dostęp w trybie tylko do odczytu (read-only) do 55 polskich baz naukowych, medycznych, publicznych, prawnych, normalizacyjnych i kulturowych przez jedno środowisko MCP i 3 skonsolidowane narzędzia (list_sources, search, get_record obsługujące 126 operacji natywnych). Obejmuje m.in. Bibliotekę Nauki, Polską Platformę Medyczną (PPM), RCIN, repozytoria uczelni (UJ, AGH, UAM, UW, ŚUM), dane badawcze (RODBuK, RePOD), RAD-on / POL-on, Ludzi Nauki, Bank Danych Lokalnych GUS, dane.gov.pl, IMGW-PIB, akty prawne ISAP (ELI Sejm API), orzeczenia sądowe SAOS, Bibliotekę Sejmową, normy PKN, Wolne Lektury, FilmPolski, Ninatekę, Fototekę, JBC/SBC/FBC (z odczytem OCR/HTR skanów) oraz Szukaj w Archiwach i inwentarze Archiwów Państwowych (AGAD, IPN Straty.pl).",
          categories: ["Research", "Education", "Legal", "Data & Analytics", "Productivity"],
          mcp_endpoint: `${origin}/mcp`,
          documentation_url: `${origin}/connectors`,
          privacy_policy_url: `${origin}/privacy`,
          terms_of_service_url: `${origin}/terms`,
          icon_url: `${origin}/icon-512.png`,
          favicon_url: `${origin}/favicon-32.png`,
          apple_touch_icon_url: `${origin}/apple-touch-icon.png`,
          support_contact: "artur@sendyka.dev",
          repository_url: "https://github.com/asterixix/polish-academic-mcp",
          website_url: "https://pamcp.pl",
          company: {
            name: "Artur Sendyka",
            website: "https://pamcp.pl",
            author_website: "https://sendyka.dev",
            repository: "https://github.com/asterixix/polish-academic-mcp",
            contact_email: "artur@sendyka.dev",
          },
          authentication: {
            type: "oauth2",
            flow: "authorization_code_pkce_s256",
            dynamic_client_registration: `${origin}/oauth/register`,
            authorization_server_metadata: `${origin}/.well-known/oauth-authorization-server`,
            protected_resource_metadata: `${origin}/.well-known/oauth-protected-resource`,
            scopes: ["mcp"],
          },
          annotations_summary: {
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: true,
            router_tool_count: routerTools.length,
            granular_tool_count: granularTools.length,
          },
          tools: routerTools,
          example_prompts: [
            "Wyszukaj w polskich bazach naukowych (Biblioteka Nauki, RUJ, AGH, PPM) najnowsze publikacje o zastosowaniu sztucznej inteligencji w diagnostyce medycznej.",
            "Znajdź w bazie ISAP obowiązujące ustawy dotyczące odnawialnych źródeł energii oraz sprawdź powiązane orzeczenia sądowe w SAOS.",
            "Pobierz z Banku Danych Lokalnych GUS (BDL) dane o przeciętnym wynagrodzeniu i stopie bezrobocia w województwach w ostatnich latach.",
            "Przeszukaj Szukaj w Archiwach, AGAD oraz bazę Straty.pl pod kątem materiałów archiwalnych i metrykalnych dotyczących rodziny Kowalskich z Warszawy.",
            "Znajdź w Wolnych Lekturach utwory Bolesława Prusa i pobierz pełny tekst wybranego opowiadania.",
          ],
        }),
      );
    }

  if (path === "/api/tools" && request.method === "GET") {
    const sources = sourcesFromRequest(request);
    const mode = modeFromRequest(request);
    const tools = await listMcpTools(env, sources, mode);
    return withCors(request, jsonResponse({ tools, count: tools.length, mode }));
  }

  return null;
}
