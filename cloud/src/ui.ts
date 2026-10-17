export function renderAuthorizePage(opts: {
  appName: string;
  clientName: string;
  userName: string;
  scope: string;
  actionUrl: string;
  denyUrl: string;
}): string {
  const action = new URL(opts.actionUrl);
  action.searchParams.set("consent", "1");
  return layout({
    title: `Autoryzacja — ${opts.appName}`,
    body: `
      <main class="card auth-card">
        <img src="/icon-512.png" alt="${escapeHtml(opts.appName)}" class="logo" width="72" height="72" />
        <h1>Połącz aplikację z MCP</h1>
        <p class="muted">Zalogowano jako <strong>${escapeHtml(opts.userName)}</strong></p>
        <p><strong>${escapeHtml(opts.clientName)}</strong> prosi o dostęp do narzędzi <strong>Polish Academic MCP</strong>.</p>
        <ul class="bullets">
          <li>Zakres uprawnień: <code>${escapeHtml(opts.scope || "mcp")}</code> (odczyt publicznych baz naukowych, prawnych, statystycznych i kulturowych)</li>
          <li>Wszystkie narzędzia działają wyłącznie w trybie do odczytu (read-only, brak operacji zapisu i usuwania)</li>
          <li>Przydział konta: <strong>100 wywołań narzędzi / miesiąc</strong></li>
        </ul>
        <form method="POST" action="${escapeHtml(action.toString())}" class="row">
          <button type="submit" class="btn primary">Autoryzuj</button>
          <a class="btn ghost" href="${escapeHtml(opts.denyUrl)}">Odmów</a>
        </form>
        <p class="muted small" style="margin-top:0.75rem"><a href="/privacy" target="_blank" rel="noreferrer">Polityka prywatności</a> · <a href="/terms" target="_blank" rel="noreferrer">Regulamin</a></p>
      </main>`,
  });
}

export function renderLoginPage(opts: { appName: string; next?: string; error?: string }): string {
  const next = opts.next ? `?next=${encodeURIComponent(opts.next)}` : "";
  return layout({
    title: `Logowanie — ${opts.appName}`,
    body: `
      <main class="card auth-card">
        <img src="/icon-512.png" alt="" class="logo" width="72" height="72" />
        <h1>Zaloguj się</h1>
        <p class="muted">ORCID, email+hasło lub passkey (WebAuthn)</p>
        ${opts.error ? `<p class="error">${escapeHtml(opts.error)}</p>` : ""}
        <a class="btn primary block" href="/api/auth/orcid/start${next}">Zaloguj przez ORCID iD</a>
        <hr />
        <form id="email-form" class="stack">
          <label>Email <input name="email" type="email" required autocomplete="username" /></label>
          <label>Hasło <input name="password" type="password" required minlength="8" autocomplete="current-password" /></label>
          <div class="row">
            <button type="submit" class="btn primary" data-mode="login">Zaloguj</button>
            <button type="button" class="btn ghost" id="register-btn">Zarejestruj</button>
          </div>
        </form>
        <div class="row" style="margin-top:1rem">
          <button type="button" class="btn ghost" id="passkey-login">Zaloguj passkey</button>
          <button type="button" class="btn ghost" id="passkey-register">Zarejestruj passkey</button>
        </div>
        <p class="muted small"><a href="/">← Wróć do AI Search</a></p>
      </main>
      <script>
        const next = ${JSON.stringify(opts.next || "/account")};
        const form = document.getElementById('email-form');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const res = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || 'Błąd logowania'); return; }
          location.href = next;
        });
        document.getElementById('register-btn').onclick = async () => {
          const fd = new FormData(form);
          const res = await fetch('/api/auth/register', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
          });
          const data = await res.json();
          if (!res.ok) { alert(data.error || 'Błąd rejestracji'); return; }
          location.href = next;
        };
        function b64urlToBuf(s) {
          const pad = '='.repeat((4 - (s.length % 4)) % 4);
          const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
          const bin = atob(b64);
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          return buf.buffer;
        }
        function bufToB64url(buf) {
          const bytes = new Uint8Array(buf);
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        }
        async function coseFromCredential(cred) {
          // Prefer getPublicKey if available; otherwise ask user agent via attestation parse is heavy —
          // we send a COSE-like map built from getPublicKey SPKI for P-256 when possible.
          if (cred.response.getPublicKey) {
            const spki = new Uint8Array(cred.response.getPublicKey());
            // SPKI uncompressed point starts after 26-byte header for P-256
            if (spki.length >= 91 && spki[26] === 0x04) {
              const x = spki.slice(27, 59);
              const y = spki.slice(59, 91);
              return { '1': 2, '3': -7, '-1': 1, '-2': bufToB64url(x), '-3': bufToB64url(y) };
            }
          }
          throw new Error('Przeglądarka nie udostępniła klucza publicznego (getPublicKey).');
        }
        document.getElementById('passkey-register').onclick = async () => {
          const email = form.email.value.trim();
          const optRes = await fetch('/api/auth/passkey/register-options', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const optData = await optRes.json();
          if (!optRes.ok) { alert(optData.error || 'Błąd'); return; }
          const o = optData.options;
          o.challenge = b64urlToBuf(o.challenge);
          o.user.id = b64urlToBuf(o.user.id);
          if (o.excludeCredentials) o.excludeCredentials = o.excludeCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
          const cred = await navigator.credentials.create({ publicKey: o });
          const cosePublicKey = await coseFromCredential(cred);
          const verify = await fetch('/api/auth/passkey/register-verify', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              user_id: optData.user_id,
              id: cred.id,
              rawId: bufToB64url(cred.rawId),
              response: {
                clientDataJSON: bufToB64url(cred.response.clientDataJSON),
                attestationObject: bufToB64url(cred.response.attestationObject),
                transports: cred.response.getTransports ? cred.response.getTransports() : []
              },
              cosePublicKey
            })
          });
          const v = await verify.json();
          if (!verify.ok) { alert(v.error || 'Błąd weryfikacji'); return; }
          location.href = next;
        };
        document.getElementById('passkey-login').onclick = async () => {
          const email = form.email.value.trim();
          const optRes = await fetch('/api/auth/passkey/login-options', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: email || undefined })
          });
          const optData = await optRes.json();
          if (!optRes.ok) { alert(optData.error || 'Błąd'); return; }
          const o = optData.options;
          o.challenge = b64urlToBuf(o.challenge);
          if (o.allowCredentials) o.allowCredentials = o.allowCredentials.map(c => ({ ...c, id: b64urlToBuf(c.id) }));
          const cred = await navigator.credentials.get({ publicKey: o });
          const verify = await fetch('/api/auth/passkey/login-verify', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: cred.id,
              response: {
                clientDataJSON: bufToB64url(cred.response.clientDataJSON),
                authenticatorData: bufToB64url(cred.response.authenticatorData),
                signature: bufToB64url(cred.response.signature),
                userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : undefined
              }
            })
          });
          const v = await verify.json();
          if (!verify.ok) { alert(v.error || 'Błąd weryfikacji'); return; }
          location.href = next;
        };
      </script>`,
  });
}

export function renderStaticPage(opts: {
  title: string;
  heading: string;
  contentHtml: string;
}): string {
  return layout({
    title: opts.title,
    body: `
      <main class="card prose">
        <a href="/" class="brand-inline"><img src="/logo.jpg" alt="" width="40" height="40" /><span>${escapeHtml(opts.heading)}</span></a>
        ${opts.contentHtml}
      </main>`,
  });
}

export function privacyPageHtml(): string {
  return renderStaticPage({
    title: "Polityka prywatności — Polish Academic",
    heading: "Polityka prywatności (Privacy Policy)",
    contentHtml: `
      <p><strong>1. Administrator i kontakt (Contact Information):</strong> <strong>Artur Sendyka</strong>,
      <a href="mailto:artur@sendyka.dev">artur@sendyka.dev</a>,
      <a href="https://pamcp.pl">pamcp.pl</a>,
      <a href="https://sendyka.dev">sendyka.dev</a>,
      <a href="https://github.com/asterixix/polish-academic-mcp">github.com/asterixix/polish-academic-mcp</a>.</p>
      <p><strong>2. Praktyki zbierania danych (Data Collection Practices):</strong> Przetwarzamy wyłącznie minimalne dane niezbędne do działania usługi: dane konta (e-mail i hash PBKDF2-SHA256, ORCID iD, klucz publiczny passkey WebAuthn), skróty SHA-256 tokenów OAuth oraz liczniki przydziału zapytań. Narzędzia MCP nie pobierają pełnej historii czatu, lokalizacji GPS ani danych wrażliwych (PHI, PCI DSS, haseł).</p>
      <p><strong>3. Wykorzystanie i przechowywanie (Usage and Storage):</strong> Dane służą wyłącznie do uwierzytelnienia OAuth 2.1 (PKCE S256), realizacji zapytań w trybie tylko do odczytu (read-only) oraz ochrony przed nadużyciami (Cloudflare D1 / KV).</p>
      <p><strong>4. Udostępnianie podmiotom trzecim (Third-Party Sharing):</strong> Infrastruktura: Cloudflare, Inc. Logowanie ORCID: ORCID, Inc. Zapytania wyszukiwawcze trafiają bezpośrednio do 51 publicznych baz naukowych, prawnych i archiwalnych (bez danych konta użytkownika). Nie sprzedajemy danych osobowych.</p>
      <p><strong>5. Okres przechowywania (Data Retention):</strong> Konto — do jego usunięcia; kody OAuth — 10 min; tokeny dostępowe — 1 h (refresh — 30 dni); cache publicznych odpowiedzi — 1–24 h.</p>
      <p><strong>6. Prawa użytkownika:</strong> Dostęp, sprostowanie, usunięcie konta, cofnięcie zgody OAuth i sprzeciw — kontakt: <a href="mailto:artur@sendyka.dev">artur@sendyka.dev</a>.</p>`,
  });
}

export function termsPageHtml(): string {
  return renderStaticPage({
    title: "Regulamin — Polish Academic",
    heading: "Regulamin usługi (Terms of Service)",
    contentHtml: `
      <p>Usługodawca: <strong>Artur Sendyka</strong> (<a href="mailto:artur@sendyka.dev">artur@sendyka.dev</a>,
      <a href="https://pamcp.pl">pamcp.pl</a>,
      <a href="https://sendyka.dev">sendyka.dev</a>,
      <a href="https://github.com/asterixix/polish-academic-mcp">github.com/asterixix/polish-academic-mcp</a>).</p>
      <ul>
        <li>Usługa zapewnia dostęp tylko do odczytu (read-only) do 51 polskich baz naukowych, prawnych, statystycznych i kulturowych.</li>
        <li>Przydział konta dla konektorów MCP OAuth: do <strong>100 wywołań narzędzi / miesiąc</strong>.</li>
        <li>Przydział AI Search: <strong>2 / tydzień</strong> bez logowania, <strong>5 / tydzień</strong> po zalogowaniu.</li>
        <li>Konektor nie prowadzi sprzedaży subskrypcji ani transakcji płatniczych w czacie.</li>
        <li>Odpowiedzi AI mogą zawierać błędy — zawsze weryfikuj cytowane źródła pierwotne.</li>
        <li>Zabrania się obchodzenia limitów i działań naruszających prawo lub regulaminy baz źródłowych.</li>
      </ul>`,
  });
}

export function connectorsPageHtml(origin: string): string {
  return renderStaticPage({
    title: "Konektory i dokumentacja API — Polish Academic",
    heading: "Oficjalny konektor i dokumentacja Target API — Polish Academic",
    contentHtml: `
      <p>Jedno ujednolicone środowisko MCP: <code>${escapeHtml(origin)}/mcp</code> (kanonicznie: <code>https://pamcp.pl/mcp</code>)</p>
      <p>Narzędzia MCP (tylko do odczytu — <code>readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true</code>): <code>list_sources</code>, <code>search</code>, <code>get_record</code> (52 polskie bazy, 116 operacji natywnych).</p>
      <p>Kod źródłowy (GitHub): <a href="https://github.com/asterixix/polish-academic-mcp">https://github.com/asterixix/polish-academic-mcp</a></p>
      <p>OAuth discovery: <code>${escapeHtml(origin)}/.well-known/oauth-authorization-server</code> · OpenAPI: <code>${escapeHtml(origin)}/openapi.json</code> · MCP Card: <code>${escapeHtml(origin)}/.well-known/mcp.json</code></p>
      <h2>Claude (claude.ai / Desktop)</h2>
      <ol>
        <li>Ustawienia → Connectors → Add custom connector</li>
        <li>URL: <code>${escapeHtml(origin)}/mcp</code></li>
        <li>Dokończ logowanie OAuth (ORCID / email / passkey)</li>
      </ol>
      <h2>ChatGPT (Connectors / Deep Research)</h2>
      <ol>
        <li>Dodaj konektor MCP wskazujący na <code>${escapeHtml(origin)}/mcp</code></li>
        <li>Alternatywnie Actions: OpenAPI z <code>${escapeHtml(origin)}/openapi.json</code></li>
        <li>Użyj endpointów <code>/api/search</code> i <code>/api/fetch</code> jako aliasów Deep Research</li>
      </ol>
      <h2>Perplexity & inne katalogi MCP</h2>
      <ol>
        <li>Dodaj Remote MCP / Connector z URL <code>${escapeHtml(origin)}/mcp</code></li>
        <li>Autoryzacja OAuth 2.1 + PKCE (S256)</li>
      </ol>
      <p><a href="/account">Panel konta i limity →</a></p>`,
  });
}

export function accountPageShell(): string {
  return layout({
    title: "Konto — Polish Academic MCP",
    body: `
      <main class="card">
        <a href="/" class="brand-inline"><img src="/logo.jpg" alt="" width="40" height="40" /><span>Panel konta</span></a>
        <div id="account-root"><p class="muted">Ładowanie…</p></div>
      </main>
      <script src="/account.js"></script>`,
  });
}

function layout(opts: { title: string; body: string }): string {
  // Inline CSS: OAuth pages must not depend on /styles.css (SPA assets may 404 on auth routes).
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta name="theme-color" content="#36054F" />
  <style>
    :root{--purple-deep:#36054f;--purple-mid:#7b52ab;--purple-soft:#efe6f8;--bg:#f7f4fb;--surface:#fff;--text:#1a0f24;--muted:#6b5a7a;--border:#e2d6ef;--danger:#b42318;--shadow:0 12px 40px rgba(54,5,79,.08);--radius:18px;--font:"Segoe UI",system-ui,-apple-system,sans-serif}
    *{box-sizing:border-box}html,body{margin:0;padding:0}
    body{font-family:var(--font);color:var(--text);background:radial-gradient(1200px 600px at 10% -10%,#efe6f8 0%,transparent 55%),radial-gradient(900px 500px at 100% 0%,#f3e9ff 0%,transparent 40%),var(--bg);min-height:100vh}
    a{color:var(--purple-mid)}.page{padding:1.25rem;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:1.75rem;max-width:960px;margin:1rem auto;width:100%}
    .auth-card{max-width:440px;text-align:center}
    .logo{border-radius:14px;display:block;margin:0 auto 1rem;object-fit:cover}
    h1{font-size:1.45rem;margin:0 0 .5rem;color:var(--purple-deep);line-height:1.25}
    .muted{color:var(--muted)}.small{font-size:.85rem}
    .error{color:var(--danger);background:#fef3f2;padding:.6rem .8rem;border-radius:10px}
    .btn{appearance:none;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:999px;padding:.7rem 1.2rem;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.4rem;font:inherit}
    .btn.primary{background:var(--purple-deep);color:#fff;border-color:var(--purple-deep)}
    .btn.ghost{background:transparent}
    .btn.block{width:100%;margin:.4rem 0}
    .btn:hover{filter:brightness(1.05)}
    .row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;justify-content:center;margin-top:1rem}
    .stack{display:grid;gap:.75rem;text-align:left}
    label{display:grid;gap:.3rem;font-size:.9rem;color:var(--muted)}
    input{width:100%;border:1px solid var(--border);border-radius:12px;padding:.7rem .85rem;font:inherit;background:#fff}
    hr{border:0;border-top:1px solid var(--border);margin:1.2rem 0}
    .bullets{text-align:left;color:var(--muted);line-height:1.5;padding-left:1.2rem}
    code{background:var(--purple-soft);padding:.1rem .35rem;border-radius:6px;font-size:.9em}
  </style>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="page">
${opts.body}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
