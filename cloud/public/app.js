(() => {
  const queryInput = document.getElementById("query");
  const form = document.getElementById("search-form");
  const statusEl = document.getElementById("status");
  const answerEl = document.getElementById("answer");
  const sourcesEl = document.getElementById("sources");
  const followupsEl = document.getElementById("followups");
  const quotaPill = document.getElementById("quota-pill");
  const authLink = document.getElementById("auth-link");
  let selectedSources = "";

  async function refreshQuota() {
    try {
      const res = await fetch("/api/quota");
      const data = await res.json();
      const q = data.ai_search;
      if (q) {
        const warn = q.used >= q.limit * 0.8 ? ` · odnowienie: ${data.resets?.ai_search ?? ""}` : "";
        quotaPill.textContent = data.authenticated
          ? `AI: ${q.used}/${q.limit} w tym tygodniu${warn}`
          : `Gość: ${q.used}/${q.limit} w tym tygodniu${warn}`;
      }
      if (data.authenticated) {
        authLink.textContent = "Wyloguj";
        authLink.href = "#";
        authLink.onclick = async (e) => {
          e.preventDefault();
          await fetch("/api/auth/logout", { method: "POST" });
          location.reload();
        };
      }
    } catch {
      quotaPill.textContent = "Limit: niedostępny";
    }
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const name = tab.dataset.tab;
      document.getElementById("tab-search").classList.toggle("hidden", name !== "search");
      document.getElementById("tab-catalog").classList.toggle("hidden", name !== "catalog");
      if (name === "catalog") loadCatalog();
    });
  });

  document.getElementById("group-chips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    document.querySelectorAll("#group-chips .chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    selectedSources = btn.dataset.sources || "";
  });

  document.getElementById("suggestions").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-q]");
    if (!btn) return;
    queryInput.value = btn.dataset.q;
    form.requestSubmit();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = queryInput.value.trim();
    if (!query) return;
    answerEl.textContent = "";
    followupsEl.innerHTML = "";
    sourcesEl.innerHTML = "";
    statusEl.textContent = "Uruchamiam AI Search…";

    const res = await fetch("/api/ai-search", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ query, sources: selectedSources || undefined }),
    });

    if (res.status === 429) {
      const data = await res.json();
      statusEl.textContent = data.message || "Limit wyczerpany";
      if (data.login_required) {
        followupsEl.innerHTML = `<a class="btn primary" href="/login">Zaloguj się, aby zwiększyć limit</a>`;
      }
      refreshQuota();
      return;
    }
    if (!res.ok || !res.body) {
      statusEl.textContent = "Błąd wyszukiwania";
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        handleEvent(event, payload);
      }
    }
    refreshQuota();
  });

  function handleEvent(event, payload) {
    if (event === "status") {
      statusEl.textContent = payload.message || "";
    }
    if (event === "tools") {
      statusEl.textContent = `Wywołuję: ${(payload.calls || []).map((c) => c.name).join(", ")}`;
    }
    if (event === "sources") {
      sourcesEl.innerHTML = (payload.items || [])
        .map(
          (item) => `<div class="source-card"><strong>${escapeHtml(item.tool)}</strong><p>${escapeHtml(item.preview || "")}</p></div>`,
        )
        .join("");
    }
    if (event === "answer") {
      answerEl.textContent = payload.text || "";
      statusEl.textContent = payload.quota
        ? `Gotowe · pozostało ${payload.quota.remaining}/${payload.quota.limit} w tym tygodniu`
        : "Gotowe";
      followupsEl.innerHTML = (payload.followups || [])
        .map((q) => `<button type="button" data-follow="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
        .join("");
      followupsEl.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          queryInput.value = btn.dataset.follow;
          form.requestSubmit();
        };
      });
    }
    if (event === "error") {
      statusEl.textContent = payload.message || "Błąd";
    }
  }

  async function loadCatalog() {
    const el = document.getElementById("tool-list");
    try {
      const res = await fetch("/api/tools");
      const data = await res.json();
      el.innerHTML = (data.tools || [])
        .map(
          (t) =>
            `<div class="tool-item"><code>${escapeHtml(t.name)}</code><div class="muted small">${escapeHtml(t.description || "")}</div></div>`,
        )
        .join("");
    } catch {
      el.innerHTML = `<p class="error">Nie udało się pobrać katalogu.</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  refreshQuota();
})();
