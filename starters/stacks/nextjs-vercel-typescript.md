---
gspec-version: 1.8.0
description: Next.js App Router, TypeScript, Tailwind CSS, deployed on Vercel
---

# Technology Stack Definition

## 1. Overview

- **Architecture style**: Server-rendered monolith (Next.js App Router with SSR/SSG)
- **Deployment target**: Cloud — Vercel (edge/serverless rendering with built-in CDN)
- **Scale & performance**: Core content loads within 2s on typical mobile networks; lean bundles via dynamic imports and tree-shaking; responsive across desktop and mobile viewports

## 2. Open Questions & Clarifications

None — all critical technology decisions are resolved.

## 3. Core Technology Stack

### Programming Languages

- **Primary**: TypeScript 5.x (strict mode enabled)
  - *Rationale*: Type safety, predictable refactors, first-class Next.js support
- **Secondary**: N/A
- **Tooling**: ESLint (TypeScript rules), Prettier (formatting)

### Runtime Environment

- **Runtime**: Node.js 20+ LTS
  - *Rationale*: Required for Next.js; LTS ensures stability and long-term security patches
- **Container runtime**: Not required — Vercel manages the runtime environment

## 4. Frontend Stack

### Framework

- **Framework**: Next.js (latest LTS release, App Router)
  - *Rationale*: Server-rendered defaults with hydration as needed; App Router provides layouts, server components, and streaming out of the box; first-class Vercel deployment support
- **Update strategy**: Track Next.js LTS releases; upgrade within 30 days of new LTS availability

### Build Tools

- **Bundler**: Next.js built-in (SWC-based compiler + Turbopack for development)
  - *Rationale*: Zero-config, optimized for the Next.js ecosystem; SWC provides fast TypeScript transpilation
- **Build optimization**: Dynamic imports for code-splitting, tree-shaking via ES module imports, Next.js image optimization pipeline

### State Management

- **Approach**: Server-first — lean on server components and server-rendered data; client-side state kept minimal
- **Libraries**: React built-in hooks (`useState`, `useReducer`, `useContext`) for local/client state
  - *Rationale*: No global state library needed for a content-driven frontend; avoids unnecessary bundle weight
- **Data fetching**: Next.js `fetch` with caching directives in server components; SWR or server actions for any client-side data needs

### Styling Technology

- **Framework**: Tailwind CSS 4.x with design tokens for spacing, typography, colors, and elevation
  - *Rationale*: Utility-first approach aligns with component-based architecture; shared configuration keeps styles cohesive; excellent tree-shaking for production
- **CSS-in-JS**: Not used — Tailwind utilities only; no raw CSS outside Tailwind conventions
- **Responsive design**: Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) for mobile-first breakpoints
- **Note**: Icon library choices are defined in `gspec/style.md`. The stack defines the CSS framework and component library; the style defines the icon set.

## 5. Backend Stack

**Not Applicable** — this is a frontend-only / static site project deployed to Vercel. No database, API layer, or server-side auth is required.

### Database

N/A

### Caching Layer

N/A — Vercel edge caching and Next.js built-in caching handle content delivery.

### Message Queue / Event Bus

N/A

## 6. Infrastructure & DevOps

### Cloud Provider

- **Provider**: Vercel
  - *Key services*: Edge network, serverless functions (if needed), image optimization, analytics
  - *Rationale*: Purpose-built for Next.js; predictable builds, automatic edge caching, zero-config HTTPS

### Container Orchestration

N/A — Vercel manages scaling and deployment infrastructure automatically.

### CI/CD Pipeline

- **Platform:** GitLab CI
  - *Rationale:* Aligns with existing team infrastructure and workflow.
- **Deployment trigger:** Merge to main branch after pipeline passes.
- **Deployment method:** Vercel Git integration for preview deployments on merge requests; production deploy on main branch merge.
- **Note:** Pipeline stages and structure (lint → typecheck → test → build → deploy) are defined in `gspec/practices.md`. This section defines the CI technology and deployment configuration.

### Infrastructure as Code

N/A — Vercel manages infrastructure. Project configuration lives in `next.config.ts` and `vercel.json` (if needed).

## 7. Data & Storage

### File Storage

- **Static assets**: Served via Vercel's built-in CDN from the `public/` directory
- **Images**: Next.js `<Image />` component with automatic optimization (WebP/AVIF, responsive sizing)
- **Asset management**: Styled placeholders used during development; final assets swapped in before release

### Data Warehouse / Analytics

N/A

## 8. Authentication & Security

N/A — no authentication or authorization layer for this frontend-only project.

### Security Tools

- **Secrets management**: Environment variables via Vercel project settings (build-time and runtime)
- **Security scanning**: `pnpm audit` for dependency vulnerabilities; Dependabot or Renovate for automated dependency updates
- **Compliance**: HTTPS enforced by Vercel; no user data collection requiring GDPR/CCPA compliance at this stage

## 9. Monitoring & Observability

Minimal for initial launch — to be revisited as the project scales.

### Application Monitoring

Deferred — Vercel provides basic deployment and function metrics out of the box.

### Logging

Deferred — Vercel function logs available via dashboard for debugging.

### Tracing

N/A

### Error Tracking

Deferred — can add Sentry when needed. Next.js has built-in error boundaries for graceful UI failure handling.

## 10. Testing Infrastructure

### Testing Frameworks

- **Unit / Integration**: Vitest
  - *Rationale*: Fast, ESM-native, excellent TypeScript support; compatible with React Testing Library
- **Component testing**: React Testing Library
  - *Rationale*: Tests components as users interact with them; encourages accessible markup
- **E2E**: Cypress (headless in CI)
  - *Rationale*: Mature ecosystem, reliable deterministic tests with `cy.intercept()` for stubbing

### Test Data Management

- **Fixtures**: JSON fixtures in `tests/fixtures/` for consistent test data
- **Mocks**: Vitest built-in mocking for modules; `cy.intercept()` for network stubbing in E2E
- **Test isolation**: Each test suite manages its own state; no shared mutable state between tests

### Performance Testing

Deferred — Core Web Vitals monitored via Lighthouse CI or Vercel Analytics when enabled.

## 11. Third-Party Integrations

### External Services

- **Formspree** — Client-side form submission service for contact forms and visitor inquiries. Accepts POST requests directly from the browser — no server-side endpoint or backend code required.
  - *Rationale*: This is a frontend-only project with no backend logic. Formspree provides form handling without requiring server actions or API routes, keeping the architecture static.
  - Free tier supports up to 50 submissions per month.
  - Submissions are forwarded to a configured email address.

### API Clients

- **HTTP client**: Native `fetch` API for Formspree form submissions. No SDK dependency needed — Formspree accepts standard `FormData` POST requests.

## 12. Development Tools

### Package Management

- **Package manager**: pnpm (latest stable)
  - *Rationale*: Fast installs, strict dependency resolution prevents phantom dependencies, disk-efficient via content-addressable storage
- **Dependency management**: `pnpm-lock.yaml` committed to version control; `pnpm audit` run in CI
- **Private registry**: N/A

### Code Quality Tools

- **Linter**: ESLint with `eslint-config-next` and TypeScript rules
- **Formatter**: Prettier (configured to align with ESLint)
- **Pre-commit hooks**: Husky + lint-staged for running ESLint and Prettier on staged files
- **Type checking**: `tsc --noEmit` in CI pipeline

### Local Development

- **Project starter**: `create-next-app` (official Next.js scaffolding tool via `pnpm create next-app`)
  - *Rationale*: Provides a well-structured starting point with recommended defaults, TypeScript config, and App Router setup
- **Setup**: `pnpm install` → `pnpm dev` (Next.js dev server with Turbopack)
- **Hot reload**: Built-in via Next.js Fast Refresh
- **Environment**: `.env.local` for local environment variables (gitignored)

## 13. Migration & Compatibility

### Legacy System Integration

N/A — greenfield project.

### Upgrade Path

- **Next.js**: Track LTS releases; review changelogs and run codemods when upgrading major versions
- **Tailwind CSS**: Follow major version migration guides; design tokens minimize breaking changes
- **Dependencies**: Automated update PRs via Renovate or Dependabot; reviewed weekly

## 14. Technology Decisions & Tradeoffs

### Key Architectural Decisions

| Decision | Choice | Alternatives Considered | Rationale |
|---|---|---|---|
| Framework | Next.js (App Router) | Remix, Astro, Nuxt | Best Vercel integration; mature SSR/SSG; React ecosystem |
| Styling | Tailwind CSS | CSS Modules, Styled Components | Utility-first aligns with component architecture; zero runtime cost; design token support |
| Testing | Vitest + Cypress | Jest + Playwright | Vitest is faster and ESM-native; Cypress is mature for E2E with reliable stubbing |
| Package manager | pnpm | npm, yarn | Strict resolution prevents phantom deps; faster installs; disk-efficient |
| Deployment | Vercel | Netlify, AWS Amplify, Cloudflare Pages | Purpose-built for Next.js; edge caching; zero-config previews |
| CI/CD | GitLab CI | GitHub Actions | Aligns with existing team infrastructure and workflow |

### Risk Mitigation

| Risk | Mitigation | Fallback |
|---|---|---|
| Next.js breaking changes on major upgrade | Pin to LTS; test upgrades in preview branch | Delay upgrade; apply security patches only |
| Vercel vendor lock-in | Keep Next.js config portable; avoid Vercel-only APIs where possible | Self-host via `next start` on any Node.js platform |
| Tailwind major version migration | Use design tokens abstraction layer; follow official migration guides | Gradual migration with compatibility layer |

## 15. Technology-Specific Practices

### Framework Conventions & Patterns

- **App Router structure:** Use the `app/` directory with route groups for logical organization (e.g., `(marketing)` for public pages). Keep layouts in `app/layout.tsx` and page-level layouts in route group folders.
- **Server vs Client Components:** Default to Server Components. Add `"use client"` only when the component needs browser APIs, event handlers, or React hooks (`useState`, `useEffect`). Push interactivity to leaf components.
- **Static generation:** Prefer static rendering (SSG) for content pages. Use `generateStaticParams()` for dynamic routes if applicable.
- **Loading and error states:** Use `loading.tsx` and `error.tsx` files at appropriate route levels for streaming UI and error boundaries.
- **Metadata:** Export `metadata` or `generateMetadata` from every page for SEO (title, description, Open Graph).

### Library Usage Patterns

- **Tailwind conventions:** Use Tailwind utility classes directly in JSX. Avoid `@apply` except in global styles for base resets. Use `cn()` or `clsx()` for conditional class merging. Follow mobile-first responsive design (`sm:`, `md:`, `lg:` breakpoints).
- **Design token mapping:** Map design tokens from `gspec/style.md` to Tailwind's theme configuration in `tailwind.config.ts` under `theme.extend`. Use CSS custom properties in `app/globals.css` for runtime theme switching (light/dark mode).
- **Image optimization:** Use Next.js `<Image />` component for all images. Set `priority` on above-the-fold hero images.

### Language Idioms

- **TypeScript strict mode:** `strict: true` in `tsconfig.json`. No `any` types — use `unknown` and narrow with type guards.
- **Path aliases:** Use `@/` alias (configured in `tsconfig.json`) for imports from the project root. Example: `import { Button } from "@/components/ui/button"`.
- **Import organization:** Group imports: (1) React/Next.js, (2) third-party libraries, (3) internal modules, (4) relative imports.
- **Async patterns:** Use `async/await` consistently. Avoid `.then()` chains.

### Stack-Specific Anti-Patterns

- **Don't use `useEffect` for data fetching** when a Server Component can do the same work — causes client-side waterfalls.
- **Don't add `"use client"` to layout files** unless absolutely necessary — this forces all children to be client components.
- **Don't import server-only modules in Client Components.** Use the `server-only` package to enforce boundaries.
- **Don't install a CSS-in-JS library** alongside Tailwind — pick one styling approach.
- **Don't use inline styles** for values that should be design tokens — map them through Tailwind configuration.
