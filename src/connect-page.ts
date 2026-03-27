const CONNECT_PROVIDER_IDS = ["chatgpt", "perplexity", "gemini", "claude"] as const;
type ConnectProviderId = (typeof CONNECT_PROVIDER_IDS)[number];

const CONNECT_PROVIDERS: Record<
  ConnectProviderId,
  { label: string; landingUrl: string; hint: string }
> = {
  chatgpt: {
    label: "ChatGPT",
    landingUrl: "https://chatgpt.com",
    hint:
      "Plus/Pro (plany z konektorami): włącz tryb deweloperski (Ustawienia → Aplikacje i konektory → Zaawansowane), utwórz konektor i wklej URL MCP (Streamable HTTP). Interfejs może nazywać to „Aplikacje” lub „Konektory”.",
  },
  perplexity: {
    label: "Perplexity",
    landingUrl: "https://docs.perplexity.ai/guides/mcp-server",
    hint:
      "Oficjalny przewodnik: Perplexity jako serwer MCP i zdalne MCP z OAuth. Podłączenie zewnętrznego MCP zależy od klienta; użyj /.well-known + /register na tym workerze, gdy klient obsługuje OAuth/DCR.",
  },
  gemini: {
    label: "Gemini",
    landingUrl: "https://aistudio.google.com",
    hint: "AI Studio: Narzędzia → Dodaj serwer MCP. CLI: ~/.gemini/settings.json httpUrl.",
  },
  claude: {
    label: "Claude",
    landingUrl: "https://claude.ai/settings/connectors",
    hint: "Sieć: Konektory → Dodaj niestandardowy konektor. Desktop: mcp-remote + URL tego serwera.",
  },
};

export function getVerifyRedirectTarget(provider: string): string | null {
  const id = provider.trim().toLowerCase();
  if (!CONNECT_PROVIDER_IDS.includes(id as ConnectProviderId)) return null;
  return CONNECT_PROVIDERS[id as ConnectProviderId].landingUrl;
}

export function listVerifyProviderIds(): string[] {
  return [...CONNECT_PROVIDER_IDS];
}

export function getConnectPageHtml(origin: string, searchParams?: URLSearchParams): string {
  const mcpUrl = `${origin}/mcp`;
  const registerUrl = `${origin}/register`;
  const authServerUrl = `${origin}/.well-known/oauth-authorization-server`;
  const verifyRedirectBase = `${origin}/verify/redirect`;

  const sp = searchParams ?? new URLSearchParams();
  const verifyMode = sp.get("verify") === "1" || sp.get("verify") === "true";
  const rawProvider = (sp.get("provider") || "").trim().toLowerCase();
  const providerParam = CONNECT_PROVIDER_IDS.includes(rawProvider as ConnectProviderId)
    ? (rawProvider as ConnectProviderId)
    : null;
  const autoRedirect = sp.get("auto") === "1" || sp.get("auto") === "true";

  const pageTitle = verifyMode ? "Weryfikacja i połączenie" : "Połączenie MCP";
  const pageInitJson = JSON.stringify({
    verifyMode,
    autoRedirect,
    providerParam,
    providers: CONNECT_PROVIDERS,
    verifyRedirectBase,
  });

  const verifyBannerHtml = verifyMode
    ? `<div class="verify-banner">Weryfikacja: tryb gościa (limity wg IP) lub token Bearer — uruchom udany test, potem otwórz czat. Z parametrem <span class="mono">?auto=1&amp;provider=claude</span> strona przekieruje po udanym teście.</div>`
    : "";

  const providerCardsHtml = CONNECT_PROVIDER_IDS.map((id) => {
    const p = CONNECT_PROVIDERS[id];
    const rUrl = `${verifyRedirectBase}?provider=${encodeURIComponent(id)}`;
    return `<div class="provider-card">
      <div class="provider-card-head">
        <button type="button" class="btn btn-primary provider-open" data-provider="${id}">Otwórz ${p.label}</button>
        <a class="provider-302 mono" href="${rUrl}">Przekierowanie 302</a>
      </div>
      <p class="muted provider-hint">${p.hint}</p>
    </div>`;
  }).join("");

  return `<!doctype html>
<html lang="pl" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${pageTitle} — Polish Academic MCP</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      :root {
        --background: oklch(0.145 0 0);
        --foreground: oklch(0.985 0 0);
        --card: oklch(0.205 0 0);
        --muted-foreground: oklch(0.708 0 0);
        --border: oklch(1 0 0 / 10%);
        --input: oklch(1 0 0 / 15%);
        --ring: oklch(0.556 0 0);
        --primary: oklch(0.922 0 0);
        --primary-foreground: oklch(0.205 0 0);
        --secondary: oklch(0.269 0 0);
        --secondary-foreground: oklch(0.985 0 0);
        --destructive: oklch(0.704 0.191 22.216);
        --radius: 0.625rem;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
        background: var(--background);
        color: var(--foreground);
      }
      .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
      .page-title { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; margin: 0 0 0.5rem; }
      .page-desc { color: var(--muted-foreground); font-size: 0.875rem; max-width: 60rem; margin: 0 0 1.5rem; }
      .grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
      @media (min-width: 1040px) { .grid { grid-template-columns: 26rem 1fr; } }
      .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem 1.125rem; }
      .card h2 { font-size: 0.9rem; font-weight: 600; margin: 0 0 0.75rem; }
      label { display: block; font-size: 0.75rem; font-weight: 500; color: var(--muted-foreground); margin: 0.75rem 0 0.375rem; }
      input, textarea {
        width: 100%;
        background: oklch(0.145 0 0);
        border: 1px solid var(--input);
        color: var(--foreground);
        border-radius: calc(var(--radius) - 2px);
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        outline: none;
      }
      input:focus, textarea:focus {
        border-color: var(--ring);
        box-shadow: 0 0 0 3px oklch(0.556 0 0 / 0.35);
      }
      textarea { min-height: 5rem; resize: vertical; font-family: "JetBrains Mono", ui-monospace, monospace; }
      .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-top: 0.75rem; }
      .btn {
        border: 1px solid var(--border);
        background: var(--secondary);
        color: var(--secondary-foreground);
        border-radius: calc(var(--radius) - 2px);
        padding: 0.5rem 0.875rem;
        font-size: 0.875rem;
        cursor: pointer;
      }
      .btn:hover { filter: brightness(1.05); }
      .btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
      .btn-danger { background: oklch(0.3 0.12 25); color: oklch(0.95 0.05 25); border-color: oklch(0.4 0.14 26); }
      .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.78rem; }
      .muted { color: var(--muted-foreground); }
      .status { margin-top: 0.75rem; font-size: 0.82rem; color: var(--muted-foreground); white-space: pre-wrap; }
      .status.err { color: var(--destructive); font-weight: 500; }
      .badge { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 0.125rem 0.5rem; font-size: 0.7rem; color: var(--muted-foreground); }
      .tool-list { margin-top: 0.75rem; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      .tool-item { padding: 0.42rem 0.65rem; border-bottom: 1px solid var(--border); font-size: 0.8rem; }
      .tool-item:last-child { border-bottom: none; }
      a { color: #9ec5ff; text-decoration: none; }
      a:hover { text-decoration: underline; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
      .split { display: grid; gap: 1rem; grid-template-columns: 1fr; }
      @media (min-width: 900px) { .split { grid-template-columns: 1fr 1fr; } }
      .verify-banner {
        border: 1px solid oklch(0.45 0.12 250);
        background: oklch(0.22 0.04 250);
        border-radius: var(--radius);
        padding: 0.65rem 0.85rem;
        font-size: 0.82rem;
        margin-bottom: 1rem;
        color: var(--foreground);
      }
      .provider-grid { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
      @media (min-width: 720px) { .provider-grid { grid-template-columns: 1fr 1fr; } }
      .provider-card {
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.65rem 0.75rem;
        background: oklch(0.17 0 0);
      }
      .provider-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem; }
      .provider-hint { margin: 0; font-size: 0.75rem; line-height: 1.45; }
      .provider-302 { font-size: 0.7rem; color: #9ec5ff; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="page-title">${pageTitle}</h1>
      <p class="page-desc">
        Konektor dla <span class="mono">${mcpUrl}</span>.
        <strong>Gość</strong> — bez nagłówka <span class="mono">Authorization</span>: tylko publiczne narzędzia, limit godzinowy wg adresu IP. <strong>Bearer</strong> — <span class="mono">OAuth access_token</span> (na klienta OAuth) lub <span class="mono">Connect JWT</span> z <span class="mono">/admin/tokens</span> (dodatkowe narzędzia i limity).
        ${verifyMode ? " To wejście <strong>weryfikacji</strong> — użyj sekcji Sesja i testu albo przejdź do aplikacji czatu poniżej." : ""}
      </p>
      ${verifyBannerHtml}

      <div class="card" style="margin-bottom:1rem;">
        <h2>Otwórz w aplikacji</h2>
        <p class="muted" style="margin:0 0 0.75rem;font-size:0.82rem;">
          Po udanym teście (gość lub Bearer) dodaj ten URL MCP w kliencie. Przyciski otwierają stronę dostawcy w nowej karcie.
          Backend <span class="mono">GET /verify/redirect?provider=…</span> zwraca <strong>302</strong> na te same strony docelowe (linki do udostępnienia).
        </p>
        <p class="mono" style="margin:0 0 0.75rem;font-size:0.8rem;word-break:break-all;">${mcpUrl}</p>
        <div class="provider-grid">
          ${providerCardsHtml}
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2>Sesja</h2>
          <label for="jwtInput">Token Bearer (opcjonalnie — puste = gość)</label>
          <textarea id="jwtInput" placeholder="OAuth access_token lub Connect JWT — sam token; puste = gość (limity wg IP)"></textarea>
          <div class="row">
            <button class="btn btn-primary" id="btnUseJwt" type="button">Zapisz + test MCP</button>
            <button class="btn" id="btnGuest" type="button">Kontynuuj jako gość + test</button>
            <button class="btn btn-danger" id="btnClear" type="button">Wyczyść token</button>
          </div>
          <div id="authStatus" class="status">Nie uruchomiono jeszcze testu.</div>
          <label style="display:block;margin-top:0.85rem;">Status tokenu</label>
          <p class="muted" style="margin:0 0 0.35rem;font-size:0.78rem;">
            Limit godzinowy wywołań narzędzi, pozostałe wywołania, bypass limitu, odwołanie — przez <span class="mono">GET /connect/token-status</span> z tym samym Bearer.
          </p>
          <div class="row">
            <button class="btn" id="btnTokenStatus" type="button">Odśwież status tokenu</button>
          </div>
          <div id="tokenStatusOut" class="status" style="margin-top:0.5rem;">Wklej token i odśwież (gość nie ma statusu tutaj).</div>
        </div>

        <div class="card">
          <h2>Endpointy połączenia</h2>
          <div class="split">
            <div>
              <div class="badge">Streamable HTTP (zalecane)</div>
              <p class="mono" style="margin-top:0.5rem;">${mcpUrl}</p>
              <p class="muted">Klient MCP przez HTTP JSON-RPC (initialize, tools/list, tools/call).</p>
            </div>
            <div>
              <div class="badge">SSE (zapasowo)</div>
              <p class="mono" style="margin-top:0.5rem;">${mcpUrl}</p>
              <p class="muted">Część klientów przełącza się na SSE na tym samym URL po nieudanym starcie streamable.</p>
            </div>
          </div>
          <p class="muted" style="margin-top:0.75rem;">
            Metadane OAuth: <a href="${authServerUrl}" target="_blank" rel="noreferrer">${authServerUrl}</a><br/>
            Rejestracja dynamiczna: <span class="mono">${registerUrl}</span> (POST — wymaga JWT poniżej)
          </p>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h2>Rejestracja klienta OAuth (RFC 7591)</h2>
        <p class="muted" style="margin:0 0 0.75rem; font-size:0.82rem;">
          Utwórz <strong>Client ID</strong> i <strong>Client Secret</strong> dla klientów MCP z OAuth (PKCE + kod autoryzacji).
          Ten sam JWT co w Sesji — <span class="mono">POST /register</span> akceptuje tokeny z panelu admin (lub legacy bypass).
        </p>
        <label for="oauthClientName">Nazwa klienta (opcjonalnie)</label>
        <input type="text" id="oauthClientName" placeholder="np. Claude Desktop / Perplexity" autocomplete="off" />
        <label for="oauthRedirectUris">Adresy przekierowania (redirect URIs)</label>
        <textarea id="oauthRedirectUris" placeholder="Jeden URI w linii, np.&#10;http://127.0.0.1:1234/callback&#10;https://twoja-aplikacja/oauth/callback"></textarea>
        <div class="row">
          <button class="btn btn-primary" id="btnRegisterOAuth" type="button">Zarejestruj klienta OAuth</button>
          <button class="btn" id="btnCopyOAuthJson" type="button">Kopiuj JSON odpowiedzi</button>
        </div>
        <div id="oauthRegStatus" class="status">Wklej JWT powyżej, dodaj redirect URI, potem zarejestruj.</div>
        <pre id="oauthRegResult" class="mono" style="display:none;margin-top:0.75rem;padding:0.65rem 0.75rem;background:oklch(0.145 0 0);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);font-size:0.75rem;max-height:14rem;overflow:auto;"></pre>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h2>Test MCP (na żywo)</h2>
        <div class="row">
          <button class="btn" id="btnProbe" type="button">Uruchom initialize + tools/list</button>
          <button class="btn" id="btnCopyCurl" type="button">Kopiuj szablon cURL</button>
        </div>
        <div id="probeStatus" class="status">Oczekiwanie na test…</div>
        <div id="toolList" class="tool-list" style="display:none;"></div>
      </div>
    </div>

    <script>
      (function () {
        var PAGE = ${pageInitJson};
        var STORAGE_KEY = "polish_academic_mcp_connect_jwt";
        var mcpUrl = ${JSON.stringify(mcpUrl)};
        var registerUrl = ${JSON.stringify(registerUrl)};
        var tokenStatusUrl = ${JSON.stringify(`${origin}/connect/token-status`)};

        function $(id) { return document.getElementById(id); }
        function setStatus(id, msg, isErr) {
          var el = $(id);
          el.className = isErr ? "status err" : "status";
          el.textContent = msg || "";
        }
        function getToken() {
          var raw = $("jwtInput").value.trim();
          return raw || "";
        }
        function applySavedToken() {
          var saved = localStorage.getItem(STORAGE_KEY);
          if (saved) $("jwtInput").value = saved;
        }
        function persistToken(token) {
          if (token) localStorage.setItem(STORAGE_KEY, token);
          else localStorage.removeItem(STORAGE_KEY);
        }

        function iso(ms) {
          if (ms == null || ms < 1) return "—";
          try { return new Date(ms).toISOString(); } catch (e) { return String(ms); }
        }

        function formatTokenStatus(j) {
          if (j.kind === "legacy_bypass") {
            return [
              "Profil: legacy bypass (wspólny sekret)",
              "Uwaga: surowy sekret nie jest akceptowany jako Bearer na /mcp — zmintuj Connect JWT albo użyj OAuth.",
              "Pełny dostęp do narzędzi: tak (tylko admin / rejestracja OAuth)",
              "Pominięcie limitu: tak",
              "Limit godzinowy: —",
              "Pozostało w tej godzinie: —",
              "Odwołany: nie"
            ].join("\\n");
          }
          if (j.kind === "oauth_access") {
            return [
              "Profil: OAuth access_token (zdalny klient MCP)",
              "Id klienta OAuth (sub): " + j.sub,
              "Wygasł: " + (j.expired ? "tak" : "nie"),
              "Ważny do: " + iso(j.expires_at_ms),
              "Budżet wywołań MCP / godz.: " + j.rate_limit_per_hour,
              "Klucz limitu: " + j.identity_key,
              "Wywoływalne narzędzia: tylko publiczny katalog"
            ].join("\\n");
          }
          var lines = [];
          lines.push("Identyfikator tokenu (jti): " + j.jti);
          if (j.label) lines.push("Etykieta: " + j.label);
          lines.push("Bypass: " + (j.bypass ? "tak" : "nie"));
          lines.push("Odwołany: " + (j.revoked ? "tak" : "nie"));
          if (j.revoked_at_ms) lines.push("Odwołano: " + iso(j.revoked_at_ms));
          lines.push("Wygasł: " + (j.expired ? "tak" : "nie"));
          lines.push("Ważny do: " + iso(j.expires_at_ms));
          if (j.bypass && !j.revoked && !j.expired) {
            lines.push("Limit: bypass (bez limitu godzinowego)");
          } else if (!j.revoked && !j.expired && !j.bypass) {
            lines.push("Limit (na godzinę): " + (j.rate_limit_per_hour != null ? j.rate_limit_per_hour : "—"));
            lines.push("Pozostało w tej godzinie: " + (j.remaining != null ? j.remaining : "—"));
            lines.push("Reset okna (ok.): " + (j.reset_in_seconds != null ? j.reset_in_seconds + " s" : "—"));
            lines.push("Poniżej limitu: " + (j.allowed ? "tak" : "nie"));
          }
          if (j.allowed_tools && j.allowed_tools.length) {
            lines.push("Dodatkowe narzędzia (poza publicznymi): " + j.allowed_tools.join(", "));
          } else {
            lines.push("Dodatkowe narzędzia: (brak — tylko publiczny katalog)");
          }
          return lines.join("\\n");
        }

        async function refreshTokenStatus() {
          var token = getToken();
          if (!token) {
            $("tokenStatusOut").className = "status";
            $("tokenStatusOut").textContent = "Brak tokenu — wklej OAuth access_token lub Connect JWT, albo użyj gościa dla MCP bez Bearer.";
            return;
          }
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "Wczytywanie…";
          try {
            var res = await fetch(tokenStatusUrl, { headers: { "Authorization": "Bearer " + token } });
            var json;
            try {
              json = await res.json();
            } catch (parseErr) {
              $("tokenStatusOut").className = "status err";
              $("tokenStatusOut").textContent = "Niepoprawna odpowiedź (HTTP " + res.status + ")";
              return;
            }
            if (!json.ok) {
              var err = json.error || "unknown";
              $("tokenStatusOut").className = "status err";
              $("tokenStatusOut").textContent = "Weryfikacja tokenu nie powiodła się: " + err + (res.status === 401 ? " (HTTP 401)" : "");
              return;
            }
            $("tokenStatusOut").className = "status";
            $("tokenStatusOut").textContent = formatTokenStatus(json);
          } catch (e) {
            $("tokenStatusOut").className = "status err";
            $("tokenStatusOut").textContent = String(e && e.message ? e.message : e);
          }
        }

        async function rpc(body, token) {
          var headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
          };
          if (token) headers["Authorization"] = "Bearer " + token;
          var res = await fetch(mcpUrl, { method: "POST", headers: headers, body: JSON.stringify(body) });
          var json = null;
          try { json = await res.json(); } catch (e) {}
          return { status: res.status, json: json };
        }

        function tryAutoRedirect() {
          if (!PAGE.autoRedirect || !PAGE.providerParam) return;
          var p = PAGE.providers[PAGE.providerParam];
          if (!p || !p.landingUrl) return;
          setStatus("probeStatus", "OK — przekierowanie do " + p.label + "…", false);
          setTimeout(function () {
            window.location.href = p.landingUrl;
          }, 500);
        }

        async function runProbe(token) {
          setStatus("probeStatus", "Uruchamianie initialize…", false);
          var init = await rpc({
            jsonrpc: "2.0",
            id: "init",
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "interactive-connect", version: "1.0.0" }
            }
          }, token);
          if (init.status !== 200 || (init.json && init.json.error)) {
            var msg = "initialize nie powiodło się (HTTP " + init.status + ")";
            if (init.json && init.json.error) msg += "\\n" + JSON.stringify(init.json.error);
            setStatus("probeStatus", msg, true);
            $("toolList").style.display = "none";
            return false;
          }

          setStatus("probeStatus", "initialize OK. Pobieranie listy narzędzi…", false);
          var list = await rpc({
            jsonrpc: "2.0",
            id: "list",
            method: "tools/list",
            params: {}
          }, token);
          if (list.status !== 200 || (list.json && list.json.error)) {
            var msg2 = "tools/list nie powiodło się (HTTP " + list.status + ")";
            if (list.json && list.json.error) msg2 += "\\n" + JSON.stringify(list.json.error);
            setStatus("probeStatus", msg2, true);
            $("toolList").style.display = "none";
            return false;
          }

          var tools = (list.json && list.json.result && list.json.result.tools) || [];
          var names = tools.map(function (t) { return t && t.name ? t.name : "(bez nazwy)"; });
          var wrap = $("toolList");
          wrap.innerHTML = names.map(function (n) { return "<div class=\\"tool-item mono\\">" + n + "</div>"; }).join("");
          wrap.style.display = "block";
          setStatus("probeStatus", "tools/list OK. Wykryto narzędzi: " + names.length, false);
          tryAutoRedirect();
          return true;
        }

        $("btnUseJwt").addEventListener("click", async function () {
          var token = getToken();
          if (!token) {
            setStatus("authStatus", "Najpierw wklej OAuth access_token lub Connect JWT.", true);
            return;
          }
          persistToken(token);
          setStatus("authStatus", "Token zapisany. Uruchamianie testu…", false);
          await runProbe(token);
          await refreshTokenStatus();
        });

        $("btnGuest").addEventListener("click", async function () {
          persistToken("");
          $("jwtInput").value = "";
          setStatus("authStatus", "Tryb gościa — bez Bearer, limity wywołań narzędzi wg IP.", false);
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "Gość — brak statusu tokenu; MCP liczy limit godzinowy po Twoim IP.";
          await runProbe("");
        });

        $("btnClear").addEventListener("click", function () {
          persistToken("");
          $("jwtInput").value = "";
          setStatus("authStatus", "Token wyczyszczony.", false);
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "Wklej token i odśwież (gość nie ma statusu tutaj).";
        });

        $("btnTokenStatus").addEventListener("click", function () {
          refreshTokenStatus();
        });

        $("btnProbe").addEventListener("click", async function () {
          var token = getToken();
          var ok = await runProbe(token);
          if (ok && token) await refreshTokenStatus();
        });

        $("btnRegisterOAuth").addEventListener("click", async function () {
          var token = getToken();
          if (!token) {
            setStatus("oauthRegStatus", "Najpierw wklej JWT administratora w Sesji.", true);
            return;
          }
          var name = $("oauthClientName").value.trim();
          var urisRaw = $("oauthRedirectUris").value.trim();
          var redirect_uris = urisRaw.split(/[\\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
          if (redirect_uris.length === 0) {
            setStatus("oauthRegStatus", "Dodaj co najmniej jeden redirect URI (jedna linia lub po przecinku).", true);
            return;
          }
          setStatus("oauthRegStatus", "Rejestrowanie…", false);
          $("oauthRegResult").style.display = "none";
          try {
            var res = await fetch(registerUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
              },
              body: JSON.stringify({
                client_name: name || undefined,
                redirect_uris: redirect_uris
              })
            });
            var json = await res.json();
            if (res.status !== 201) {
              setStatus("oauthRegStatus", "Rejestracja nie powiodła się (HTTP " + res.status + ")\\n" + JSON.stringify(json, null, 2), true);
              return;
            }
            setStatus("oauthRegStatus", "Sukces. Przechowuj client_secret bezpiecznie — wyświetlany jest tylko raz.", false);
            $("oauthRegResult").textContent = JSON.stringify(json, null, 2);
            $("oauthRegResult").style.display = "block";
          } catch (e) {
            setStatus("oauthRegStatus", String(e && e.message ? e.message : e), true);
          }
        });

        $("btnCopyOAuthJson").addEventListener("click", async function () {
          var text = $("oauthRegResult").textContent || "";
          if (!text.trim()) {
            setStatus("oauthRegStatus", "Brak danych do skopiowania — najpierw zarejestruj.", true);
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            setStatus("oauthRegStatus", "Skopiowano JSON rejestracji OAuth.", false);
          } catch (e) {
            setStatus("oauthRegStatus", "Kopiowanie nie powiodło się: " + String(e && e.message ? e.message : e), true);
          }
        });

        $("btnCopyCurl").addEventListener("click", async function () {
          var token = getToken();
          var auth = token
            ? "  -H \\"Authorization: Bearer " + token + "\\" \\\\\\n"
            : "  # Brak Authorization — gość (limit wg IP)\\n";
          var cmd = [
            "curl -s \\"" + mcpUrl + "\\" \\\\\\n",
            "  -H \\"Content-Type: application/json\\" \\\\\\n",
            "  -H \\"Accept: application/json, text/event-stream\\" \\\\\\n",
            auth,
            "  -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":\\"list\\",\\"method\\":\\"tools/list\\",\\"params\\":{}}'"
          ].join("");
          try {
            await navigator.clipboard.writeText(cmd);
            setStatus("authStatus", "Skopiowano szablon cURL.", false);
          } catch (e) {
            setStatus("authStatus", "Kopiowanie nie powiodło się: " + String(e && e.message ? e.message : e), true);
          }
        });

        document.querySelectorAll(".provider-open").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = btn.getAttribute("data-provider");
            if (!id || !PAGE.providers[id]) return;
            window.open(PAGE.providers[id].landingUrl, "_blank", "noopener,noreferrer");
          });
        });

        applySavedToken();
        refreshTokenStatus();
      })();
    </script>
  </body>
</html>`;
}
