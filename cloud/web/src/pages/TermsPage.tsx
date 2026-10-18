import { Link } from "react-router-dom";

export function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-soft md:p-8">
      <h1 className="font-display text-3xl font-semibold text-brand-700">Regulamin usługi (Terms of Service)</h1>
      <p className="mt-2 text-sm text-fg-tertiary">Polish Academic · obowiązuje od października 2026</p>

      <section className="mt-6 space-y-3 text-[15px] leading-relaxed text-fg-secondary">
        <h2 className="text-lg font-semibold text-fg-primary">1. Usługodawca i kontakt</h2>
        <p>
          Usługę świadczy <strong>Artur Sendyka</strong> (e-mail wsparcia:{" "}
          <a href="mailto:artur@sendyka.dev" className="text-brand-600 hover:underline">
            artur@sendyka.dev
          </a>
          , serwis:{" "}
          <a href="https://pamcp.pl" className="text-brand-600 hover:underline">
            https://pamcp.pl
          </a>
          , strona autora:{" "}
          <a href="https://sendyka.dev" className="text-brand-600 hover:underline">
            https://sendyka.dev
          </a>
          , repozytorium open-source:{" "}
          <a
            href="https://github.com/asterixix/polish-academic-mcp"
            className="text-brand-600 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            github.com/asterixix/polish-academic-mcp
          </a>
          ). Usługa jest niezależnym projektem i nie jest powiązana ani autoryzowana przez OpenAI,
          Anthropic ani Perplexity.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">2. Charakter usługi</h2>
        <p>
          Polish Academic udostępnia ujednolicony dostęp w trybie tylko do odczytu (read-only) do 51
          publicznych polskich baz naukowych, prawnych, statystycznych, normalizacyjnych i
          kulturowych oraz zdalny konektor MCP (OAuth 2.1) dla klientów takich jak Claude, ChatGPT i
          Perplexity. Usługa ma charakter informacyjno-badawczy i jest odpowiednia dla szerokiego
          grona odbiorców (w tym uczniów i studentów powyżej 13. roku życia). Odpowiedzi modeli AI
          mogą zawierać nieścisłości — zawsze weryfikuj cytowane źródła pierwotne.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">3. Przydziały zasobów (uprawnienia konta)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>AI Search bez logowania: do 2 wyszukiwań na tydzień (reset w niedzielę o 17:00, czas polski),</li>
          <li>AI Search po zalogowaniu: do 5 wyszukiwań na tydzień (reset w niedzielę o 17:00, czas polski),</li>
          <li>Konektor MCP przez OAuth 2.1: do 100 wywołań narzędzi na miesiąc kalendarzowy UTC.</li>
        </ul>
        <p>
          Korzystanie z usługi jest bezpłatne w ramach powyższych przydziałów. Konektor nie sprzedaje
          produktów cyfrowych, tokenów ani subskrypcji wewnątrz interfejsu czatu i nie inicjuje
          procesów płatniczych.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">4. Konta, bezpieczeństwo i dozwolony użytek</h2>
        <p>
          Rejestracja i logowanie są możliwe przez ORCID OAuth, e-mail z hasłem (PBKDF2-SHA256) lub
          klucz bezpieczeństwa passkey (WebAuthn). Podłączając zewnętrzny konektor (Claude, ChatGPT,
          Perplexity), użytkownik autoryzuje odczyt danych z publicznych rejestrów w ramach swojego
          przydziału. Zabrania się obchodzenia limitów zapytań, naruszania regulaminów baz
          źródłowych, przesyłania danych wrażliwych (PCI DSS, PHI, tajemnic uwierzytelniających) oraz
          działań niezgodnych z prawem.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">5. Odpowiedzialność</h2>
        <p>
          Usługa przekazuje dane bezpośrednio z publicznych interfejsów instytucji naukowych,
          rządowych i archiwalnych. Usługodawca nie odpowiada za chwilową niedostępność zewnętrznych
          rejestrów ani za decyzje prawne lub medyczne podejmowane na podstawie wyszukanych
          dokumentów.
        </p>

        <h2 className="text-lg font-semibold text-fg-primary">6. Prawo właściwe</h2>
        <p>
          Do regulaminu stosuje się prawo polskie oraz przepisy Unii Europejskiej (w tym RODO). Spory
          rozstrzygają właściwe sądy powszechne, z zachowaniem praw konsumentów.
        </p>
      </section>

      <p className="mt-8 text-sm">
        <Link to="/privacy" className="text-brand-600 hover:underline">
          Polityka prywatności (Privacy Policy)
        </Link>
      </p>
    </article>
  );
}
