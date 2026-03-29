---
gspec-version: 1.8.0
description: Static documentation site with Astro, Tailwind CSS v4, and GitHub Pages deployment
---

# Technology Stack Definition

## 1. Overview

A **static documentation and marketing site** deployed to GitHub Pages, built with Astro.

### Architecture Style
- Static site generated at build time with Astro. Zero server-side runtime, no API, no database.
- Content-driven architecture — pages are authored in Markdown/MDX and rendered through Astro layouts.

### Deployment Target
- **GitHub Pages** — static hosting via GitHub Actions build-and-deploy workflow

### Scale & Performance Requirements
- Minimal — static HTML/CSS/JS served via GitHub Pages CDN. Target: perfect Lighthouse scores.

---

## 2. Open Questions & Clarifications

None — all information is clear.

---

## 3. Core Technology Stack

### Programming Languages

- **Astro Components (.astro)** — Astro's template syntax, compiles to static HTML
- **Markdown / MDX** — Content authoring format for documentation pages
- **JavaScript (ES Modules)** — For any client-side interactivity and Astro configuration

### Runtime Environment

- **Node.js 20 LTS** — Used for Astro site generation. Pinned in CI via GitHub Actions `setup-node`.
- **No container runtime** — Not needed for a static site.

---

## 4. Frontend Stack

### Framework

- **Astro 5.x** — Static site generator optimized for content-driven websites
- **Why Astro:**
  - Zero-JS-by-default output — ideal for a documentation/marketing site
  - First-class Markdown/MDX support for content pages
  - Built-in GitHub Pages deployment support
  - Islands architecture allows interactive components only where needed
  - Excellent performance out of the box (perfect Lighthouse scores)

### Build Tools

- **Astro's built-in Vite pipeline** — Astro uses Vite internally; no separate bundler configuration needed
- **`@astrojs/tailwind`** — Official Astro integration for Tailwind CSS

### State Management

Not Applicable — static site with no client-side application state. Any interactivity (e.g., mobile nav toggle, copy-to-clipboard) uses vanilla JS or Astro's `<script>` tags.

### Styling Technology

- **Tailwind CSS v4** — Utility-first CSS framework
- **Why Tailwind:**
  - Astro's officially recommended CSS solution with first-class integration
  - Zero runtime cost in static output — all CSS is purged and inlined at build time
  - Rapid prototyping without writing custom CSS files
  - Excellent responsive design utilities built in
  - `@tailwindcss/typography` plugin for long-form Markdown content styling
- **Design token mapping:** Visual design values defined in `gspec/style.md` (when created) map to Tailwind's `theme.extend` configuration in `tailwind.config.mjs`. Custom colors, fonts, and spacing scales are defined there as Tailwind theme tokens rather than as raw CSS variables.

---

## 5. Backend Stack

Not Applicable — fully static site. Pre-rendered HTML served from GitHub Pages.

---

## 6. Infrastructure & DevOps

### Cloud Provider

- **GitHub** — The sole infrastructure provider:
  - **GitHub Pages** — Static site hosting
  - **GitHub Actions** — CI/CD pipeline

### Container Orchestration

Not Applicable.

### CI/CD Pipeline

- **Platform:** GitHub Actions
  - *Rationale:* Native integration with GitHub Pages deployment. No external CI service needed — hosting and CI are in the same platform.
- **Deployment trigger:** Push to main (website paths changed). Path filtering scopes the workflow so non-website changes don't trigger deploys.
- **Deployment method:** `actions/deploy-pages` for GitHub Pages.
- **Note:** Pipeline stages and structure (lint → typecheck → test → build → deploy) are defined in `gspec/practices.md`. This section defines the CI technology and deployment configuration.

### Infrastructure as Code

Not Applicable — GitHub Pages requires no IaC. Configuration lives in `astro.config.mjs` and the GitHub Actions workflow YAML.

---

## 7. Data & Storage

### File Storage

- **GitHub Pages CDN** — Serves all static assets (HTML, CSS, JS, images)

### Data Warehouse / Analytics

Not Applicable.

---

## 8. Authentication & Security

Not Applicable — public static site with no user accounts, login, or protected resources.

---

## 9. Monitoring & Observability

Not Applicable — static site with no runtime to monitor. GitHub Pages provides basic traffic analytics if needed.

---

## 10. Testing Infrastructure

### Testing Frameworks

- **Build verification:** `astro build` succeeds without errors (run in CI)
- **Lighthouse CI** (optional) — Automated performance/accessibility audits in the deploy pipeline
- **E2E testing:** Playwright or Cypress can be used for page-load and rendering verification if required by `gspec/practices.md`. Astro sites are static HTML — E2E tests verify that built pages load correctly and key elements are visible.
- **Unit testing:** Vitest can be used for testing utility functions, content collection schemas, or build-time logic if required by `gspec/practices.md`.
- **Note:** Whether and how extensively to test is defined by `gspec/practices.md`. This section defines the available tools for the Astro ecosystem.

### Test Data Management

Not Applicable — static content site with no database.

### Performance Testing

Not Applicable — static assets served from CDN.

---

## 11. Third-Party Integrations

### External Services

- **GitHub Pages** — Website hosting
- **Formspree** — Client-side form submission service for contact forms and visitor inquiries. Accepts POST requests directly from the browser — no server-side endpoint or backend code required.
  - *Rationale*: GitHub Pages is static-only with no server runtime. Formspree provides form handling without requiring a backend, keeping the architecture zero-server.
  - Free tier supports up to 50 submissions per month.
  - Submissions are forwarded to a configured email address.

### API Clients

Not Applicable.

---

## 12. Development Tools

### Package Management

- **Package manager:** npm
  - *Rationale:* Simplest option for a static site with minimal dependencies. No need for pnpm's strict resolution or yarn's workspaces at this project scale.
- Key dependencies:
  - `astro` — Static site generator
  - `@astrojs/tailwind` — Tailwind CSS integration
  - `tailwindcss` — Utility-first CSS framework
  - `@tailwindcss/typography` — Prose styling for Markdown content

### Project Structure

```
src/
├── pages/        # Astro file-based routing
├── layouts/      # Page layouts (BaseLayout.astro, DocsLayout.astro)
├── components/   # Reusable UI components
└── content/      # Markdown/MDX content collections
public/           # Static assets (images, favicon, etc.)
astro.config.mjs
tailwind.config.mjs
package.json
```

### Code Quality Tools

- **Prettier** — Consistent formatting across Astro, JS, and Markdown files (with `prettier-plugin-astro`)
- No linter needed at current project scale

### Local Development

- `npm run dev` — Astro dev server with hot reload
- No Docker, no database, no environment variables required

---

## 13. Migration & Compatibility

### Legacy System Integration

Not Applicable.

### Upgrade Path

- **Astro:** Follow major version upgrade guides. Astro has a strong commitment to smooth upgrades.
- **Tailwind CSS:** v4 is current. Tailwind's upgrade tooling (`@tailwindcss/upgrade`) automates major version migrations.
- **Node.js:** Track LTS releases. Currently Node 20, move to Node 22 LTS when ready.

---

## 14. Technology Decisions & Tradeoffs

### Key Architectural Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| **Astro over Next.js/Docusaurus** | Zero-JS static output, first-class Markdown support, perfect for docs/marketing. No SSR or client-side routing needed. | Next.js (overkill, ships unnecessary JS), Docusaurus (opinionated, React dependency), Hugo (Go templating less flexible) |
| **Tailwind over vanilla CSS** | Rapid styling, consistent design system, excellent Astro integration, zero runtime cost after build. | Vanilla CSS (slower to prototype), UnoCSS (smaller ecosystem), Open Props (less utility coverage) |
| **Minimal dependency footprint** | Only install what the static site needs — no backend or toolchain bloat. | Monorepo with shared dependencies (unnecessary complexity for a static site) |

### Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Astro breaking changes | Pin major version, test builds in CI, upgrade intentionally |
| Tailwind v4 is relatively new | First-class Astro support, large community, easy fallback to v3 |
| GitHub Pages limitations | Static site is tiny; unlikely to hit limits. Could move to Cloudflare Pages or Netlify if needed |

---

## 15. Technology-Specific Practices

### Framework Conventions & Patterns

- Use `.astro` components for all pages and layouts — avoid unnecessary framework islands (React, Vue, etc.) unless interactive behavior demands it
- Use Astro's built-in `<Content />` component for rendering Markdown content
- Use Astro's file-based routing in `src/pages/`
- Use `src/layouts/` for page layouts (e.g., `BaseLayout.astro`, `DocsLayout.astro`)
- Use `src/components/` for reusable UI components
- Prefer Astro's scoped `<style>` blocks for component-specific styles that don't map well to Tailwind utilities
- Use content collections (`src/content/`) for structured Markdown content with schema validation
- Use `getStaticPaths()` for dynamic routes when generating pages from collections

### Library Usage Patterns

#### Tailwind CSS in Astro
- Configure design tokens in `tailwind.config.mjs` under `theme.extend` — map from `gspec/style.md` definitions
- Use `@apply` sparingly and only in Astro `<style>` blocks for repeated patterns — prefer utility classes in templates
- Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`) rather than custom media queries
- Use `@tailwindcss/typography` with the `prose` class for all long-form Markdown content

### Language Idioms

- **ES Modules** — Use `import`/`export` exclusively
- **`node:` prefix for built-in modules** — e.g., `import { readFileSync } from 'node:fs'`

### Client-Side Interactivity Patterns

Features that require client-side JavaScript (e.g., theme switching, mobile navigation toggles) need special handling in Astro's zero-JS architecture:

- **Inline `<script>` tags** — For critical scripts that must run before paint (e.g., applying a saved theme preference to prevent flash-of-wrong-theme), use an inline `<script is:inline>` in the `<head>` of the base layout. This runs synchronously before the page renders.
- **Astro `<script>` tags** — For non-critical interactivity (e.g., hamburger menu toggle, copy-to-clipboard), use Astro's `<script>` tags in components. These are bundled and optimized by Astro.
- **Framework islands** — Use `client:load`, `client:visible`, or `client:idle` only for complex interactive components that require a framework (React, Vue, etc.). Most interactivity on a static site can be handled with vanilla JS.

### Stack-Specific Anti-Patterns

- **Don't add React/Vue/Svelte islands** unless a component genuinely requires client-side interactivity — the site should ship zero JS by default
- **Don't use `client:load`** without justification — prefer `client:visible` or `client:idle` if interactivity is truly needed
- **Don't install a CSS-in-JS library** alongside Tailwind — pick one styling approach
- **Don't over-engineer navigation or routing** — Astro's file-based routing handles everything a docs site needs
- **Don't use deferred scripts for theme initialization** — theme preference must be applied in a blocking inline script to prevent flash-of-wrong-theme
