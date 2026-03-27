/**
 * Worker-served admin UI (HTML/CSS/JS). Styling follows shadcn/ui dark theme tokens (zinc palette).
 * Not bundled with React — avoids a separate build step for the Worker.
 */

export function getAdminPanelHtml(defaultLimitPerHour: number): string {
  const L = String(defaultLimitPerHour);
  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>Token admin — rate limit</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
      :root {
        --background: oklch(0.145 0 0);
        --foreground: oklch(0.985 0 0);
        --card: oklch(0.205 0 0);
        --card-foreground: oklch(0.985 0 0);
        --popover: oklch(0.205 0 0);
        --popover-foreground: oklch(0.985 0 0);
        --primary: oklch(0.922 0 0);
        --primary-foreground: oklch(0.205 0 0);
        --secondary: oklch(0.269 0 0);
        --secondary-foreground: oklch(0.985 0 0);
        --muted: oklch(0.269 0 0);
        --muted-foreground: oklch(0.708 0 0);
        --accent: oklch(0.269 0 0);
        --accent-foreground: oklch(0.985 0 0);
        --destructive: oklch(0.704 0.191 22.216);
        --border: oklch(1 0 0 / 10%);
        --input: oklch(1 0 0 / 15%);
        --ring: oklch(0.556 0 0);
        --radius: 0.625rem;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
        background: var(--background);
        color: var(--foreground);
        line-height: 1.5;
      }
      .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
      .page-title { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; margin: 0 0 0.5rem; }
      .page-desc { color: var(--muted-foreground); font-size: 0.875rem; max-width: 42rem; margin: 0 0 1.5rem; }
      .grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
      @media (min-width: 1024px) { .grid { grid-template-columns: 22rem 1fr; } }
      .card {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 1rem 1.125rem;
      }
      .card h2 { font-size: 0.875rem; font-weight: 600; margin: 0 0 0.75rem; color: var(--card-foreground); }
      label { display: block; font-size: 0.75rem; font-weight: 500; color: var(--muted-foreground); margin: 0.75rem 0 0.375rem; }
      .label-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
      .label-row input[type="checkbox"] { accent-color: var(--primary); width: 1rem; height: 1rem; }
      input[type="text"], input[type="number"], input[type="search"], textarea {
        width: 100%;
        background: oklch(0.145 0 0);
        border: 1px solid var(--input);
        color: var(--foreground);
        border-radius: calc(var(--radius) - 2px);
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        outline: none;
        transition: box-shadow 0.15s, border-color 0.15s;
      }
      input:focus, textarea:focus {
        border-color: var(--ring);
        box-shadow: 0 0 0 3px oklch(0.556 0 0 / 0.35);
      }
      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem;
        padding: 0.5rem 0.875rem; font-size: 0.875rem; font-weight: 500; border-radius: calc(var(--radius) - 2px);
        border: 1px solid var(--border); background: var(--secondary); color: var(--secondary-foreground);
        cursor: pointer; transition: background 0.15s, border-color 0.15s;
      }
      .btn:hover { background: oklch(0.32 0 0); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-primary { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
      .btn-primary:hover { filter: brightness(1.06); }
      .btn-ghost { background: transparent; border-color: transparent; }
      .btn-ghost:hover { background: var(--muted); }
      .btn-destructive { background: oklch(0.278 0.089 26.042); color: oklch(0.936 0.032 17.717); border-color: oklch(0.396 0.141 25.723); }
      .btn-destructive:hover { filter: brightness(1.08); }
      .btn-sm { padding: 0.375rem 0.625rem; font-size: 0.8125rem; }
      .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
      .status { margin-top: 0.75rem; font-size: 0.8125rem; color: var(--muted-foreground); white-space: pre-wrap; }
      .status.err { color: var(--destructive); font-weight: 500; }
      .mint-output { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
      .mint-output textarea {
        min-height: 5.5rem; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.75rem;
      }
      .toast {
        position: fixed; bottom: 1.25rem; right: 1.25rem; z-index: 60;
        background: var(--popover); color: var(--popover-foreground); border: 1px solid var(--border);
        padding: 0.75rem 1rem; border-radius: var(--radius); font-size: 0.875rem;
        box-shadow: 0 10px 40px oklch(0 0 0 / 0.45);
        opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity 0.2s, transform 0.2s;
      }
      .toast.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
      .toolbar { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center; margin-bottom: 0.75rem; }
      .toolbar input[type="search"] { flex: 1; min-width: 12rem; max-width: 24rem; }
      .table-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
      table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
      thead { background: oklch(0.18 0 0); }
      th, td { text-align: left; padding: 0.625rem 0.75rem; border-bottom: 1px solid var(--border); }
      th { font-weight: 500; color: var(--muted-foreground); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
      tr:last-child td { border-bottom: none; }
      tr:hover td { background: oklch(0.22 0 0); }
      .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 0.75rem; }
      .badge { display: inline-flex; align-items: center; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.6875rem; font-weight: 600; }
      .badge-ok { background: oklch(0.269 0 0); color: var(--muted-foreground); }
      .badge-warn { background: oklch(0.35 0.08 85); color: oklch(0.95 0.02 85); }
      .badge-bad { background: oklch(0.3 0.12 25); color: oklch(0.95 0.05 25); }
      .empty { padding: 2rem; text-align: center; color: var(--muted-foreground); font-size: 0.875rem; }
      /* Dialog (shadcn Dialog-like) */
      .dialog-overlay {
        position: fixed; inset: 0; z-index: 50; background: oklch(0 0 0 / 0.6);
        display: flex; align-items: center; justify-content: center; padding: 1rem;
        opacity: 0; pointer-events: none; transition: opacity 0.2s;
      }
      .dialog-overlay.open { opacity: 1; pointer-events: auto; }
      .dialog-content {
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        width: 100%; max-width: 28rem; max-height: min(90vh, 36rem); overflow-y: auto;
        padding: 1.25rem; box-shadow: 0 25px 50px oklch(0 0 0 / 0.5);
      }
      .dialog-header { margin-bottom: 1rem; }
      .dialog-title { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.25rem; }
      .dialog-desc { font-size: 0.8125rem; color: var(--muted-foreground); margin: 0; }
      .dialog-footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem; padding-top: 1rem; border-top: 1px solid var(--border); flex-wrap: wrap; }
      .dl { display: grid; gap: 0.5rem; font-size: 0.8125rem; }
      .dl dt { color: var(--muted-foreground); font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; }
      .dl dd { margin: 0 0 0.75rem; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="page-title">Token administration</h1>
      <p class="page-desc">
        Manage rate-limit bypass JWTs. Panel auth uses
        <span class="mono">Authorization: Bearer &lt;ADMIN_PANEL_BEARER_SECRET&gt;</span>.
        The token is stored in <span class="mono">localStorage</span>.
      </p>

      <div class="grid">
        <div class="card">
          <h2>Mint token</h2>
          <div class="label-row">
            <input id="mintBypass" type="checkbox" />
            <label for="mintBypass" style="margin:0;font-size:0.875rem;color:var(--foreground);">Bypass rate limit completely</label>
          </div>
          <label for="mintLimit">Limit / hour (when not bypassing)</label>
          <input id="mintLimit" type="number" min="1" step="1" value="${L}" />
          <label for="mintExpiresInDays">Expires in (days)</label>
          <input id="mintExpiresInDays" type="number" min="1" step="1" value="30" />
          <label for="mintLabel">Label (optional)</label>
          <input id="mintLabel" type="text" placeholder="e.g. alice-prod" autocomplete="off" />
          <label for="mintOwner">Owner (optional)</label>
          <input id="mintOwner" type="text" placeholder="e.g. Alice" autocomplete="off" />
          <label for="mintAllowedTools">Additional tools (optional, comma/newline separated)</label>
          <textarea id="mintAllowedTools" rows="3" placeholder="e.g. eval_response, repod_get_dataset"></textarea>
          <div class="row" style="margin-top:1rem;">
            <button type="button" class="btn btn-primary" id="btnMint">Mint token</button>
            <button type="button" class="btn" id="btnReload">Refresh list</button>
          </div>
          <div id="status" class="status"></div>
          <div class="mint-output">
            <label>JWT (copy after mint)</label>
            <textarea id="mintedToken" readonly spellcheck="false" placeholder="Mint a token to see the JWT here…"></textarea>
            <div class="row" style="margin-top:0.5rem;">
              <button type="button" class="btn btn-primary btn-sm" id="btnCopy" disabled>Copy JWT</button>
              <button type="button" class="btn btn-sm" id="btnClearMint">Clear</button>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Tokens</h2>
          <div class="toolbar">
            <input type="search" id="tokenSearch" placeholder="Search by jti, label, owner…" autocomplete="off" />
          </div>
          <div id="tokenTableWrap" class="table-wrap">
            <div id="tokenListPlaceholder" class="empty">Loading…</div>
            <table id="tokenTable" style="display:none;">
              <thead>
                <tr>
                  <th>Label / owner</th>
                  <th>jti</th>
                  <th>Status</th>
                  <th>Usage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="tokenTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div id="toast" class="toast" role="status" aria-live="polite"></div>

    <div id="dialogOverlay" class="dialog-overlay" aria-hidden="true">
      <div class="dialog-content" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
        <div class="dialog-header">
          <h2 id="dialogTitle" class="dialog-title">Token details</h2>
          <p class="dialog-desc">View metadata and adjust policy. Changes apply immediately in KV.</p>
        </div>
        <div class="dl" id="dialogReadonly"></div>
        <div id="dialogForm">
          <label for="dlgLabel">Label</label>
          <input type="text" id="dlgLabel" />
          <label for="dlgOwner">Owner</label>
          <input type="text" id="dlgOwner" />
          <div class="label-row">
            <input type="checkbox" id="dlgBypass" />
            <label for="dlgBypass" style="margin:0;font-size:0.875rem;">Bypass rate limit</label>
          </div>
          <label for="dlgLimit">Limit / hour</label>
          <input type="number" id="dlgLimit" min="1" step="1" />
          <label for="dlgExpires">Expires (local)</label>
          <input type="datetime-local" id="dlgExpires" />
          <label for="dlgAllowedTools">Additional tools (comma/newline separated)</label>
          <textarea id="dlgAllowedTools" rows="3" placeholder="e.g. eval_response, repod_get_dataset"></textarea>
        </div>
        <div class="dialog-footer">
          <button type="button" class="btn btn-destructive" id="dlgRevoke">Revoke</button>
          <button type="button" class="btn" id="dlgClose">Cancel</button>
          <button type="button" class="btn btn-primary" id="dlgSave">Save changes</button>
        </div>
      </div>
    </div>

    <script>
(function () {
  var DEFAULT_LIMIT = ${L};
  var LOCAL_KEY = "polish_academic_mcp_admin_bearer";
  var cachedTokens = [];
  var selectedJti = null;

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, isErr) {
    var el = $("status");
    el.className = isErr ? "status err" : "status";
    el.textContent = msg || "";
  }

  function showToast(text) {
    var t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

  function nowIso(ms) {
    try { return new Date(ms).toISOString(); } catch (e) { return "—"; }
  }

  function esc(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function truncate(s, n) {
    s = String(s || "");
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
  }

  function parseAllowedTools(raw) {
    if (!raw) return [];
    var unique = {};
    String(raw)
      .split(/[\\n,]/g)
      .map(function (x) { return x.trim(); })
      .filter(Boolean)
      .forEach(function (x) { unique[x] = true; });
    return Object.keys(unique).sort();
  }

  function getAdminBearer() {
    var saved = window.localStorage.getItem(LOCAL_KEY);
    if (saved && String(saved).trim()) return String(saved).trim();
    var entered = window.prompt(
      "Enter admin bearer token.\\nPaste only the token value (not \\"Bearer …\\")."
    );
    if (entered === null) return "";
    var token = String(entered).trim();
    if (!token) return "";
    window.localStorage.setItem(LOCAL_KEY, token);
    return token;
  }

  var adminBearer = getAdminBearer();
  if (!adminBearer) setStatus("Missing admin token — reload and paste your panel secret.", true);

  function callAdmin(path, init) {
    var headers = Object.assign({}, (init && init.headers) || {}, {
      Authorization: "Bearer " + adminBearer
    });
    return fetch(path, Object.assign({}, init || {}, { headers })).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error("HTTP " + res.status + ": " + (text || "").slice(0, 400));
        });
      }
      return res.json();
    });
  }

  function tokenMatchesQuery(t, q) {
    if (!q) return true;
    q = q.toLowerCase();
    var parts = [
      t.jti,
      t.label,
      t.owner,
      t.bypass ? "bypass" : "",
      t.revokedAtMs ? "revoked" : "",
      t.expiresAtMs && Date.now() >= t.expiresAtMs ? "expired" : ""
    ];
    return parts.some(function (p) {
      return p && String(p).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var q = ($("tokenSearch").value || "").trim().toLowerCase();
    var list = cachedTokens.filter(function (t) { return tokenMatchesQuery(t, q); });
    var tbody = $("tokenTableBody");
    var table = $("tokenTable");
    var ph = $("tokenListPlaceholder");

    tbody.innerHTML = "";
    if (!cachedTokens.length) {
      ph.style.display = "block";
      ph.textContent = "No tokens yet.";
      table.style.display = "none";
      return;
    }
    if (!list.length) {
      ph.style.display = "block";
      ph.textContent = "No matches for your search.";
      table.style.display = "none";
      return;
    }
    ph.style.display = "none";
    table.style.display = "table";

    list.forEach(function (t) {
      var tr = document.createElement("tr");
      var revoked = !!t.revokedAtMs;
      var expired = !revoked && t.expiresAtMs && Date.now() >= t.expiresAtMs;
      var statusClass = revoked ? "badge-bad" : expired ? "badge-warn" : "badge-ok";
      var statusText = revoked ? "Revoked" : expired ? "Expired" : t.bypass ? "Bypass" : "Limited";
      tr.innerHTML =
        "<td>" +
        "<div><strong>" + esc(t.label || "—") + "</strong></div>" +
        "<div style=\\"color:var(--muted-foreground);font-size:0.75rem;\\">" + esc(t.owner || "—") + "</div>" +
        "</td>" +
        "<td class=\\"mono\\">" + esc(truncate(t.jti, 14)) + "</td>" +
        "<td><span class=\\"badge " + statusClass + "\\">" + esc(statusText) + "</span></td>" +
        "<td class=\\"mono\\" style=\\"font-size:0.75rem;\\">" +
        esc(String(t.usage && t.usage.remaining != null ? t.usage.remaining : "—")) +
        " / " +
        esc(String(t.bypass ? "∞" : t.limitPerHour)) +
        "</td>" +
        "<td><button type=\\"button\\" class=\\"btn btn-sm btn-ghost\\" data-jti=\\"" + esc(t.jti) + "\\">Details</button></td>";
      tr.querySelector("button").addEventListener("click", function () {
        openDialog(t.jti);
      });
      tbody.appendChild(tr);
    });
  }

  function loadTokens() {
    $("tokenListPlaceholder").style.display = "block";
    $("tokenListPlaceholder").textContent = "Loading…";
    $("tokenTable").style.display = "none";
    callAdmin("/admin/tokens?limit=200", { method: "GET" })
      .then(function (data) {
        cachedTokens = data.tokens || [];
        renderTable();
      })
      .catch(function (e) {
        cachedTokens = [];
        $("tokenListPlaceholder").textContent = "Failed to load.";
        setStatus(String(e.message || e), true);
      });
  }

  function findToken(jti) {
    for (var i = 0; i < cachedTokens.length; i++) {
      if (cachedTokens[i].jti === jti) return cachedTokens[i];
    }
    return null;
  }

  function msToDatetimeLocalValue(ms) {
    var d = new Date(ms);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function parseDatetimeLocal(s) {
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  function openDialog(jti) {
    selectedJti = jti;
    var t = findToken(jti);
    if (!t) return;
    var ro = $("dialogReadonly");
    ro.innerHTML =
      "<dt>jti</dt><dd class=\\"mono\\">" + esc(t.jti) + "</dd>" +
      "<dt>Created</dt><dd>" + esc(nowIso(t.createdAtMs)) + "</dd>" +
      "<dt>Expires (UTC)</dt><dd>" + esc(nowIso(t.expiresAtMs)) + "</dd>" +
      (t.revokedAtMs
        ? "<dt>Revoked</dt><dd>" + esc(nowIso(t.revokedAtMs)) + "</dd>"
        : "") +
      "<dt>Usage (rolling hour)</dt><dd class=\\"mono\\">remaining " +
      esc(String(t.usage && t.usage.remaining != null ? t.usage.remaining : "—")) +
      ", reset in " +
      esc(String(t.usage && t.usage.resetInSeconds != null ? t.usage.resetInSeconds : "—")) +
      "s</dd>";

    $("dlgLabel").value = t.label || "";
    $("dlgOwner").value = t.owner || "";
    $("dlgBypass").checked = !!t.bypass;
    $("dlgLimit").value = String(t.limitPerHour || DEFAULT_LIMIT);
    $("dlgLimit").disabled = !!t.bypass;
    $("dlgExpires").value = msToDatetimeLocalValue(t.expiresAtMs);
    $("dlgAllowedTools").value = Array.isArray(t.allowedTools) ? t.allowedTools.join(", ") : "";

    $("dlgRevoke").disabled = !!t.revokedAtMs;
    $("dlgSave").disabled = !!t.revokedAtMs;

    $("dialogOverlay").classList.add("open");
    $("dialogOverlay").setAttribute("aria-hidden", "false");
  }

  function closeDialog() {
    selectedJti = null;
    $("dialogOverlay").classList.remove("open");
    $("dialogOverlay").setAttribute("aria-hidden", "true");
  }

  $("dlgBypass").addEventListener("change", function () {
    $("dlgLimit").disabled = $("dlgBypass").checked;
  });

  $("dialogOverlay").addEventListener("click", function (e) {
    if (e.target === $("dialogOverlay")) closeDialog();
  });
  $("dlgClose").addEventListener("click", closeDialog);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $("dialogOverlay").classList.contains("open")) closeDialog();
  });

  $("dlgSave").addEventListener("click", function () {
    if (!selectedJti) return;
    var t = findToken(selectedJti);
    if (!t || t.revokedAtMs) return;
    var expMs = parseDatetimeLocal($("dlgExpires").value);
    if (expMs == null) {
      setStatus("Invalid expiry date.", true);
      return;
    }
    var body = {
      bypass: $("dlgBypass").checked,
      limitPerHour: Math.max(1, parseInt($("dlgLimit").value, 10) || DEFAULT_LIMIT),
      expiresAtMs: expMs,
      label: $("dlgLabel").value.trim(),
      owner: $("dlgOwner").value.trim(),
      allowedTools: parseAllowedTools($("dlgAllowedTools").value)
    };
    callAdmin("/admin/tokens/" + encodeURIComponent(selectedJti), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function () {
        showToast("Token updated");
        closeDialog();
        loadTokens();
      })
      .catch(function (e) {
        setStatus(String(e.message || e), true);
      });
  });

  $("dlgRevoke").addEventListener("click", function () {
    if (!selectedJti) return;
    var reason = window.prompt("Revoke reason (optional):") || "";
    if (reason === null) return;
    callAdmin("/admin/tokens/" + encodeURIComponent(selectedJti) + "/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || undefined })
    })
      .then(function () {
        showToast("Token revoked");
        closeDialog();
        loadTokens();
      })
      .catch(function (e) {
        setStatus(String(e.message || e), true);
      });
  });

  $("tokenSearch").addEventListener("input", renderTable);

  $("btnReload").addEventListener("click", loadTokens);

  $("btnClearMint").addEventListener("click", function () {
    $("mintedToken").value = "";
    $("btnCopy").disabled = true;
  });

  $("btnCopy").addEventListener("click", function () {
    var token = $("mintedToken").value;
    if (!token) return;
    navigator.clipboard.writeText(token).then(
      function () {
        showToast("JWT copied to clipboard");
        setStatus("Copied.");
      },
      function (e) {
        setStatus("Copy failed: " + String(e && e.message ? e.message : e), true);
      }
    );
  });

  $("btnMint").addEventListener("click", function () {
    if (!adminBearer) return;
    var bypass = $("mintBypass").checked;
    var limitPerHour = Math.max(1, Math.floor(Number($("mintLimit").value) || DEFAULT_LIMIT));
    var expiresInDays = Math.max(1, Math.floor(Number($("mintExpiresInDays").value) || 30));
    var label = $("mintLabel").value.trim() || undefined;
    var owner = $("mintOwner").value.trim() || undefined;
    var allowedTools = parseAllowedTools($("mintAllowedTools").value);
    var expiresAtMs = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

    setStatus("Minting…");
    callAdmin("/admin/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bypass: bypass,
        limitPerHour: limitPerHour,
        expiresAtMs: expiresAtMs,
        label: label,
        owner: owner,
        allowedTools: allowedTools
      })
    })
      .then(function (data) {
        var token = data.token || "";
        $("mintedToken").value = token;
        $("btnCopy").disabled = !token;
        setStatus("Minted successfully.");
        showToast("Token minted — copy the JWT");
        if (token) {
          navigator.clipboard.writeText(token).then(
            function () {
              showToast("JWT auto-copied to clipboard");
            },
            function () {}
          );
        }
        loadTokens();
      })
      .catch(function (e) {
        setStatus(String(e.message || e), true);
      });
  });

  $("mintBypass").addEventListener("change", function (e) {
    $("mintLimit").disabled = e.target.checked;
  });

  loadTokens();
})();
    </script>
  </body>
</html>`;
}
