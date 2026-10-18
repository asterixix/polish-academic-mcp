(async () => {
  const root = document.getElementById("account-root");
  const me = await fetch("/api/auth/me").then((r) => r.json());
  const quota = await fetch("/api/quota").then((r) => r.json());

  if (!me.user) {
    root.innerHTML = `
      <p>Nie jesteś zalogowany.</p>
      <a class="btn primary" href="/login">Zaloguj / zarejestruj</a>
      <p class="muted small">Po zalogowaniu limit AI Search wzrasta do 5/tydzień, a konektory MCP (Claude, ChatGPT, Perplexity) mają 100 zapytań/miesiąc.</p>`;
    return;
  }

  const u = me.user;
  const ai = quota.ai_search || { used: 0, limit: 5 };
  const mcp = quota.mcp || { used: 0, limit: 100 };
  const aiPct = Math.min(100, Math.round((ai.used / Math.max(1, ai.limit)) * 100));
  const mcpPct = Math.min(100, Math.round((mcp.used / Math.max(1, mcp.limit)) * 100));
  const origin = location.origin;

  root.innerHTML = `
    <p>Witaj, <strong>${escape(u.display_name || u.email || u.orcid_id || u.id)}</strong></p>
    <p class="muted small">${u.email ? `Email: ${escape(u.email)} · ` : ""}${u.orcid_id ? `ORCID: ${escape(u.orcid_id)}` : ""}</p>

    <h2>Limit AI Search (tydzień)</h2>
    <div class="meter"><span style="width:${aiPct}%"></span></div>
    <p>${ai.used} / ${ai.limit}</p>
    ${ai.used >= ai.limit * 0.8 ? `<p role="status">${ai.used >= ai.limit ? "Wykorzystano cały limit" : "Zbliżasz się do limitu"}. Odnowienie: ${quota.resets?.ai_search ?? "—"}.</p>` : ""}

    <h2>Limit MCP OAuth (miesiąc)</h2>
    <div class="meter"><span style="width:${mcpPct}%"></span></div>
    <p>${mcp.used} / ${mcp.limit}</p>
    ${mcp.used >= mcp.limit * 0.8 ? `<p role="status">${mcp.used >= mcp.limit ? "Wykorzystano cały limit" : "Zbliżasz się do limitu"}. Odnowienie: ${quota.resets?.mcp ?? "—"}.</p>` : ""}

    <h2>Dodaj konektor</h2>
    <p>URL MCP: <code>${origin}/mcp</code></p>
    <div class="row" style="justify-content:flex-start">
      <a class="btn primary" href="/connectors">Instrukcje Claude / ChatGPT / Perplexity</a>
      <button class="btn ghost" id="logout">Wyloguj</button>
    </div>`;

  document.getElementById("logout").onclick = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/";
  };

  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
