export function getConnectPageHtml(origin: string): string {
  const mcpUrl = `${origin}/mcp`;
  const registerUrl = `${origin}/register`;
  const authServerUrl = `${origin}/.well-known/oauth-authorization-server`;

  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>MCP Connect — Polish Academic MCP</title>
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
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="page-title">MCP Connect</h1>
      <p class="page-desc">
        Interactive connector for <span class="mono">${mcpUrl}</span>.
        Continue as guest (public tools) or provide JWT bearer token (extended tools/limits).
      </p>

      <div class="grid">
        <div class="card">
          <h2>Session</h2>
          <label for="jwtInput">JWT token (optional)</label>
          <textarea id="jwtInput" placeholder="Paste Bearer token value only (without 'Bearer ')"></textarea>
          <div class="row">
            <button class="btn btn-primary" id="btnUseJwt" type="button">Use JWT + test</button>
            <button class="btn" id="btnGuest" type="button">Continue as guest + test</button>
            <button class="btn btn-danger" id="btnClear" type="button">Clear token</button>
          </div>
          <div id="authStatus" class="status">No test executed yet.</div>
          <label style="display:block;margin-top:0.85rem;">Token status</label>
          <p class="muted" style="margin:0 0 0.35rem;font-size:0.78rem;">
            Hourly tool-call limit, remaining calls, rate-limit bypass, revoke — via <span class="mono">GET /connect/token-status</span> with the same Bearer token.
          </p>
          <div class="row">
            <button class="btn" id="btnTokenStatus" type="button">Refresh token status</button>
          </div>
          <div id="tokenStatusOut" class="status" style="margin-top:0.5rem;">Paste JWT and refresh.</div>
        </div>

        <div class="card">
          <h2>Connection endpoints</h2>
          <div class="split">
            <div>
              <div class="badge">Streamable HTTP (recommended)</div>
              <p class="mono" style="margin-top:0.5rem;">${mcpUrl}</p>
              <p class="muted">Use MCP client over HTTP JSON-RPC (initialize, tools/list, tools/call).</p>
            </div>
            <div>
              <div class="badge">Legacy SSE fallback</div>
              <p class="mono" style="margin-top:0.5rem;">${mcpUrl}</p>
              <p class="muted">Some clients fallback to SSE on same endpoint when streamable init fails.</p>
            </div>
          </div>
          <p class="muted" style="margin-top:0.75rem;">
            OAuth metadata: <a href="${authServerUrl}" target="_blank" rel="noreferrer">${authServerUrl}</a><br/>
            Dynamic registration: <span class="mono">${registerUrl}</span> (POST, requires JWT below)
          </p>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h2>OAuth client registration (RFC 7591)</h2>
        <p class="muted" style="margin:0 0 0.75rem; font-size:0.82rem;">
          Register a <strong>Client ID</strong> and <strong>Client Secret</strong> for MCP clients that expect OAuth (PKCE + authorization code).
          The same JWT as in Session must be sent — only tokens minted in the admin panel (or legacy bypass) are accepted by <span class="mono">POST /register</span>.
        </p>
        <label for="oauthClientName">Client name (optional)</label>
        <input type="text" id="oauthClientName" placeholder="e.g. Claude Desktop / Perplexity" autocomplete="off" />
        <label for="oauthRedirectUris">Redirect URIs</label>
        <textarea id="oauthRedirectUris" placeholder="One URI per line, e.g.&#10;http://127.0.0.1:1234/callback&#10;https://your-app/oauth/callback"></textarea>
        <div class="row">
          <button class="btn btn-primary" id="btnRegisterOAuth" type="button">Register OAuth client</button>
          <button class="btn" id="btnCopyOAuthJson" type="button">Copy response JSON</button>
        </div>
        <div id="oauthRegStatus" class="status">Paste JWT above, add redirect URI(s), then register.</div>
        <pre id="oauthRegResult" class="mono" style="display:none;margin-top:0.75rem;padding:0.65rem 0.75rem;background:oklch(0.145 0 0);border:1px solid var(--border);border-radius:calc(var(--radius) - 2px);font-size:0.75rem;max-height:14rem;overflow:auto;"></pre>
      </div>

      <div class="card" style="margin-top:1rem;">
        <h2>Live MCP probe</h2>
        <div class="row">
          <button class="btn" id="btnProbe" type="button">Run initialize + tools/list</button>
          <button class="btn" id="btnCopyCurl" type="button">Copy cURL template</button>
        </div>
        <div id="probeStatus" class="status">Waiting for probe…</div>
        <div id="toolList" class="tool-list" style="display:none;"></div>
      </div>
    </div>

    <script>
      (function () {
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
              "Profile: legacy bypass (shared secret)",
              "Full tool access: yes",
              "Rate limit bypass: yes",
              "Hourly limit: —",
              "Remaining this hour: —",
              "Revoked: no"
            ].join("\\n");
          }
          var lines = [];
          lines.push("Token id (jti): " + j.jti);
          if (j.label) lines.push("Label: " + j.label);
          lines.push("Bypass: " + (j.bypass ? "yes" : "no"));
          lines.push("Revoked: " + (j.revoked ? "yes" : "no"));
          if (j.revoked_at_ms) lines.push("Revoked at: " + iso(j.revoked_at_ms));
          lines.push("Expired: " + (j.expired ? "yes" : "no"));
          lines.push("Valid until: " + iso(j.expires_at_ms));
          if (j.bypass && !j.revoked && !j.expired) {
            lines.push("Rate limit: bypass (no hourly cap)");
          } else if (!j.revoked && !j.expired && !j.bypass) {
            lines.push("Rate limit (per hour): " + (j.rate_limit_per_hour != null ? j.rate_limit_per_hour : "—"));
            lines.push("Remaining this hour: " + (j.remaining != null ? j.remaining : "—"));
            lines.push("Sliding window reset (approx): " + (j.reset_in_seconds != null ? j.reset_in_seconds + " s" : "—"));
            lines.push("Under limit: " + (j.allowed ? "yes" : "no"));
          }
          if (j.allowed_tools && j.allowed_tools.length) {
            lines.push("Extra allowed tools (beyond public): " + j.allowed_tools.join(", "));
          } else {
            lines.push("Extra allowed tools: (none — public catalog only)");
          }
          return lines.join("\\n");
        }

        async function refreshTokenStatus() {
          var token = getToken();
          if (!token) {
            $("tokenStatusOut").className = "status";
            $("tokenStatusOut").textContent = "No JWT in Session — paste a token to see limits, bypass, and revoke state.";
            return;
          }
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "Loading…";
          try {
            var res = await fetch(tokenStatusUrl, { headers: { "Authorization": "Bearer " + token } });
            var json;
            try {
              json = await res.json();
            } catch (parseErr) {
              $("tokenStatusOut").className = "status err";
              $("tokenStatusOut").textContent = "Bad response (HTTP " + res.status + ")";
              return;
            }
            if (!json.ok) {
              var err = json.error || "unknown";
              $("tokenStatusOut").className = "status err";
              $("tokenStatusOut").textContent = "Token check failed: " + err + (res.status === 401 ? " (HTTP 401)" : "");
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

        async function runProbe(token) {
          setStatus("probeStatus", "Running initialize...", false);
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
            var msg = "initialize failed (HTTP " + init.status + ")";
            if (init.json && init.json.error) msg += "\\n" + JSON.stringify(init.json.error);
            setStatus("probeStatus", msg, true);
            $("toolList").style.display = "none";
            return;
          }

          setStatus("probeStatus", "initialize OK. Listing tools...", false);
          var list = await rpc({
            jsonrpc: "2.0",
            id: "list",
            method: "tools/list",
            params: {}
          }, token);
          if (list.status !== 200 || (list.json && list.json.error)) {
            var msg2 = "tools/list failed (HTTP " + list.status + ")";
            if (list.json && list.json.error) msg2 += "\\n" + JSON.stringify(list.json.error);
            setStatus("probeStatus", msg2, true);
            $("toolList").style.display = "none";
            return;
          }

          var tools = (list.json && list.json.result && list.json.result.tools) || [];
          var names = tools.map(function (t) { return t && t.name ? t.name : "(unnamed)"; });
          var wrap = $("toolList");
          wrap.innerHTML = names.map(function (n) { return "<div class=\\"tool-item mono\\">" + n + "</div>"; }).join("");
          wrap.style.display = "block";
          setStatus("probeStatus", "tools/list OK. Detected tools: " + names.length, false);
        }

        $("btnUseJwt").addEventListener("click", async function () {
          var token = getToken();
          if (!token) {
            setStatus("authStatus", "Provide JWT token first, or use guest mode.", true);
            return;
          }
          persistToken(token);
          setStatus("authStatus", "JWT saved. Running probe...", false);
          await runProbe(token);
          await refreshTokenStatus();
        });

        $("btnGuest").addEventListener("click", async function () {
          persistToken("");
          $("jwtInput").value = "";
          setStatus("authStatus", "Guest mode selected. Running probe...", false);
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "No JWT — guest mode (IP rate limits apply to MCP).";
          await runProbe("");
        });

        $("btnClear").addEventListener("click", function () {
          persistToken("");
          $("jwtInput").value = "";
          setStatus("authStatus", "Token cleared.", false);
          $("tokenStatusOut").className = "status";
          $("tokenStatusOut").textContent = "Paste JWT and refresh.";
        });

        $("btnTokenStatus").addEventListener("click", function () {
          refreshTokenStatus();
        });

        $("btnProbe").addEventListener("click", async function () {
          var token = getToken();
          await runProbe(token);
          if (token) await refreshTokenStatus();
        });

        $("btnRegisterOAuth").addEventListener("click", async function () {
          var token = getToken();
          if (!token) {
            setStatus("oauthRegStatus", "Paste your admin JWT in Session first.", true);
            return;
          }
          var name = $("oauthClientName").value.trim();
          var urisRaw = $("oauthRedirectUris").value.trim();
          var redirect_uris = urisRaw.split(/[\\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
          if (redirect_uris.length === 0) {
            setStatus("oauthRegStatus", "Add at least one redirect URI (one per line or comma-separated).", true);
            return;
          }
          setStatus("oauthRegStatus", "Registering…", false);
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
              setStatus("oauthRegStatus", "Registration failed (HTTP " + res.status + ")\\n" + JSON.stringify(json, null, 2), true);
              return;
            }
            setStatus("oauthRegStatus", "Success. Store the client_secret securely; it is shown only once.", false);
            $("oauthRegResult").textContent = JSON.stringify(json, null, 2);
            $("oauthRegResult").style.display = "block";
          } catch (e) {
            setStatus("oauthRegStatus", String(e && e.message ? e.message : e), true);
          }
        });

        $("btnCopyOAuthJson").addEventListener("click", async function () {
          var text = $("oauthRegResult").textContent || "";
          if (!text.trim()) {
            setStatus("oauthRegStatus", "Nothing to copy — register first.", true);
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            setStatus("oauthRegStatus", "OAuth registration JSON copied.", false);
          } catch (e) {
            setStatus("oauthRegStatus", "Copy failed: " + String(e && e.message ? e.message : e), true);
          }
        });

        $("btnCopyCurl").addEventListener("click", async function () {
          var token = getToken();
          var auth = token ? "  -H \\"Authorization: Bearer " + token + "\\" \\\\\\n" : "";
          var cmd = [
            "curl -s \\"" + mcpUrl + "\\" \\\\\\n",
            "  -H \\"Content-Type: application/json\\" \\\\\\n",
            "  -H \\"Accept: application/json, text/event-stream\\" \\\\\\n",
            auth,
            "  -d '{\\"jsonrpc\\":\\"2.0\\",\\"id\\":\\"list\\",\\"method\\":\\"tools/list\\",\\"params\\":{}}'"
          ].join("");
          try {
            await navigator.clipboard.writeText(cmd);
            setStatus("authStatus", "cURL template copied.", false);
          } catch (e) {
            setStatus("authStatus", "Copy failed: " + String(e && e.message ? e.message : e), true);
          }
        });

        applySavedToken();
        refreshTokenStatus();
      })();
    </script>
  </body>
</html>`;
}
