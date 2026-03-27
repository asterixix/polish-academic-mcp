/** Wspólny branding stron HTML serwowanych przez Worker. */

export const SITE_PROJECT_NAME = "Polish Academic MCP";
export const SITE_AUTHOR_URL = "https://sendyka.dev";
export const SITE_GITHUB_URL = "https://github.com/asterixix/polish-academic-mcp";
export const SITE_LICENSE_URL = `${SITE_GITHUB_URL}/blob/main/LICENSE`;

/** Style dla `.site-brand-top` i `.site-footer` (dark, neutralne tokeny). */
export function siteBrandingStyles(): string {
  return `
      .site-brand-top {
        border-bottom: 1px solid var(--site-brand-border, oklch(1 0 0 / 12%));
        background: var(--site-brand-bg, oklch(0.17 0 0));
      }
      .site-brand-skip {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .site-brand-inner {
        max-width: 1200px;
        margin: 0 auto;
        padding: 0.65rem 1rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem 1rem;
      }
      .site-brand-name {
        font-weight: 700;
        font-size: 0.95rem;
        letter-spacing: -0.02em;
        color: inherit;
        text-decoration: none;
      }
      .site-brand-name:hover { text-decoration: underline; }
      .site-footer {
        margin-top: 2rem;
        padding: 1.25rem 1rem 2rem;
        border-top: 1px solid var(--site-brand-border, oklch(1 0 0 / 12%));
        background: var(--site-brand-bg-footer, oklch(0.12 0 0));
      }
      .site-footer-inner { padding-top: 0.25rem; }
      .site-footer-line {
        margin: 0;
        font-size: 0.8125rem;
        color: var(--site-footer-muted, oklch(0.708 0 0));
        line-height: 1.6;
      }
      .site-footer-line a {
        color: var(--site-footer-link, #9ec5ff);
        text-decoration: none;
      }
      .site-footer-line a:hover { text-decoration: underline; }
      .site-footer-line strong { color: var(--site-footer-strong, oklch(0.985 0 0)); font-weight: 600; }
    `;
}

export function siteBrandingTopBarHtml(homeHref: string): string {
  return `<a class="site-brand-skip" href="#main-content">Przejdź do treści</a>
    <header class="site-brand-top" role="banner">
      <div class="site-brand-inner">
        <a class="site-brand-name" href="${homeHref}">${SITE_PROJECT_NAME}</a>
      </div>
    </header>`;
}

export function siteBrandingFooterHtml(): string {
  return `<footer class="site-footer" role="contentinfo">
      <div class="site-brand-inner site-footer-inner">
        <p class="site-footer-line">
          <strong>${SITE_PROJECT_NAME}</strong>
          —
          <a href="${SITE_AUTHOR_URL}" target="_blank" rel="noopener noreferrer">Strona autora projektu</a>
          —
          <a href="${SITE_GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
          —
          Licencja <a href="${SITE_LICENSE_URL}" target="_blank" rel="noopener noreferrer">MIT</a>
        </p>
      </div>
    </footer>`;
}
