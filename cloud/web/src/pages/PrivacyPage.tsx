import { Link } from "react-router-dom";

export function PrivacyPage() {
  return (
    <article className="prose-legal mx-auto max-w-3xl rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft md:p-8">
      <h1 className="font-display text-3xl font-semibold text-brand-700">
        Polityka prywatności (Privacy Policy)
      </h1>
      <p className="mt-2 text-sm text-fg-tertiary">
        Stan na październik 2026 · RODO / GDPR · Wymogi katalogów Claude, ChatGPT i Perplexity
      </p>

      <section className="mt-6 space-y-3 text-[15px] leading-relaxed text-fg-secondary">
        <h2 className="text-lg font-semibold text-fg-primary">1. Administrator i kontakt (Contact Information)</h2>
        <p>
          Administratorem danych osobowych jest <strong>Artur Sendyka</strong>, e-mail kontaktowy i
          wsparcia:{" "}
          <a href="mailto:artur@sendyka.dev" className="text-brand-600 hover:underline">
            artur@sendyka.dev
          </a>
          , serwis chmurowy:{" "}
          <a href="https://pamcp.pl" className="text-brand-600 hover:underline">
            pamcp.pl
          </a>
          , strona autora:{" "}
          <a href="https://sendyka.dev" className="text-brand-600 hover:underline">
            sendyka.dev
          </a>
          , kod źródłowy:{" "}
          <a
            href="https://github.com/asterixix/polish-academic-mcp"
            className="text-brand-600 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            github.com/asterixix/polish-academic-mcp
          </a>
          .
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">
          2. Praktyki zbierania danych i minimalizacja (Data Collection Practices)
        </h2>
        <p>
          Stosujemy ścisłą zasadę minimalizacji danych (Privacy by Design). Narzędzia MCP przyjmują
          wyłącznie parametry przedmiotowe niezbędne do wykonania zapytania badawczego (np. fraza
          wyszukiwania, identyfikator rekordu, sygnatura aktu prawnego). Serwer <strong>nie</strong>{" "}
          pobiera pełnej historii konwersacji z klienta AI, nie śledzi dokładnej lokalizacji GPS i
          nie zbiera danych szczególnych kategorii (PHI, danych kart płatniczych PCI DSS, numerów
          PESEL/SSN ani haseł zewnętrznych).
        </p>
        <p>W ramach konta chmurowego i autoryzacji OAuth 2.1 przetwarzamy wyłącznie:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>adres e-mail oraz skrót hasła PBKDF2-SHA256 (przy rejestracji e-mail),</li>
          <li>identyfikator ORCID iD oraz wyświetlaną nazwę badacza (przy logowaniu ORCID OAuth),</li>
          <li>klucz publiczny WebAuthn / passkey, identyfikator klucza i licznik podpisów,</li>
          <li>kryptograficzne skróty SHA-256 tokenów dostępowych i odświeżających OAuth 2.1,</li>
          <li>sumaryczne liczniki przydziału zapytań (miesięczny licznik MCP, tygodniowy licznik AI Search),</li>
          <li>jednokierunkowy skrót SHA-256 z adresu IP i nagłówka User-Agent wyłącznie dla anonimowego limitu AI Search.</li>
        </ul>
        <p>
          Lokalny serwer uruchamiany przez <code>npx polish-academic-mcp</code> działa bezpośrednio
          na urządzeniu użytkownika i nie przesyła żadnych danych teletransmisyjnych do autora
          pakietu.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">
          3. Wykorzystanie i przechowywanie danych (Usage and Storage)
        </h2>
        <p>
          Dane są wykorzystywane wyłącznie do uwierzytelnienia użytkownika (OAuth 2.1 z PKCE S256),
          obsługi wywołań narzędzi MCP w trybie tylko do odczytu (read-only), egzekwowania limitów
          zasobów, diagnostyki jakości odpowiedzi oraz ochrony przed nadużyciami (art. 6 ust. 1 lit. b
          oraz f RODO). Nie prowadzimy profilowania behawioralnego, reklamowego ani śledzenia
          międzywitrynowego. Dane kont i skróty tokenów są przechowywane w bazie Cloudflare D1
          (SQLite), a tymczasowy cache publicznych odpowiedzi API (TTL 1–24 h) w Cloudflare KV.
        </p>
        <p>
          <strong>Logi aktywności (diagnostyka).</strong> Dla poprawy jakości wyszukiwania zapisujemy
          skrócone zdarzenia AI Search i wywołań MCP: treść zapytania (przycięta), status, Trace ID,
          nazwy narzędzi i metadane techniczne. Dla gości anonimowych nie zapisujemy e-maila ani
          adresu IP - wyłącznie jednokierunkowy skrót (SHA-256) identyfikatora sesji. Dla kont
          zalogowanych zdarzenia mogą być powiązane z ID użytkownika. Logi nie zawierają pełnych
          transkryptów rozmów gości.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">
          4. Udostępnianie podmiotom trzecim (Third-Party Sharing)
        </h2>
        <p>
          Nie sprzedajemy ani nie udostępniamy danych osobowych podmiotom reklamowym. W zakresie
          niezbędnym do działania usługi korzystamy z następujących kategorii odbiorców:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Cloudflare, Inc.</strong> — infrastruktura chmurowa (Workers, D1, KV, AI Gateway),
          </li>
          <li>
            <strong>Publiczne bazy źródłowe (51 instytucji)</strong> — zapytania wyszukiwawcze (bez
            danych konta użytkownika) są kierowane bezpośrednio do publicznych API (m.in. Biblioteka
            Nauki, GUS BDL, Sejm ELI / ISAP, SAOS, Wolne Lektury, Narodowe Archiwum Cyfrowe, Archiwa
            Państwowe),
          </li>
          <li>
            <strong>ORCID, Inc.</strong> — wyłącznie gdy użytkownik wybierze logowanie przez ORCID OAuth,
          </li>
          <li>
            <strong>Dostawcy modeli LLM (Eden AI / Anthropic / OpenRouter / Cloudflare Workers AI)</strong>{" "}
            — wyłącznie przy korzystaniu z przeglądarkowego trybu AI Search na stronie głównej (nie
            dotyczy wywołań konektora MCP z Claude, ChatGPT lub Perplexity).
          </li>
        </ul>

        <h2 className="text-lg font-semibold text-fg-primary">
          5. Okres przechowywania danych (Data Retention)
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Dane konta (e-mail, ORCID, passkey): przez czas posiadania konta do momentu jego usunięcia na żądanie użytkownika,</li>
          <li>Kody autoryzacyjne OAuth: maksymalnie 10 minut (jednorazowe),</li>
          <li>Tokeny dostępowe OAuth: 1 godzina (tokeny odświeżające: 30 dni lub do odwołania),</li>
          <li>Liczniki przydziału (quotas): przypisane do bieżącego okresu rozliczeniowego (tydzień ISO lub miesiąc UTC),</li>
          <li>Pamięć podręczna odpowiedzi z baz publicznych (KV): od 1 godziny do 24 godzin (wyłącznie dane publiczne).</li>
          <li>Logi aktywności anonimowej: maksymalnie 30 dni,</li>
          <li>Logi aktywności konta zalogowanego: maksymalnie 180 dni (lub do usunięcia konta).</li>
        </ul>

        <h2 className="text-lg font-semibold text-fg-primary">
          6. Prawa użytkownika i kontrola nad danymi (User Controls & GDPR Rights)
        </h2>
        <p>
          Każdy użytkownik ma prawo dostępu do swoich danych, ich sprostowania, usunięcia („prawo do
          bycia zapomnianym”), ograniczenia przetwarzania, przenoszenia danych, cofnięcia autoryzacji
          konektora OAuth w dowolnym momencie oraz wniesienia sprzeciwu. W celu realizacji praw lub
          natychmiastowego usunięcia konta napisz na adres:{" "}
          <a href="mailto:artur@sendyka.dev" className="text-brand-600 hover:underline">
            artur@sendyka.dev
          </a>
          . Przysługuje również prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych
          (UODO).
        </p>
      </section>

      <p className="mt-8 text-sm">
        <Link to="/" className="text-brand-600 hover:underline">
          Wróć do wyszukiwania
        </Link>
      </p>
    </article>
  );
}
