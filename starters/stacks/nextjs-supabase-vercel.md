---
gspec-version: 1.8.0
description: Full-stack SaaS with Next.js App Router, Supabase (Postgres, Auth, RLS), and Vercel deployment
---

# Technology Stack

## 1. Overview

- **Architecture style:** Full-stack monolith — a single Next.js application handling both frontend rendering and API routes, backed by Supabase for managed database, authentication, and real-time capabilities.
- **Deployment target:** Vercel (serverless edge and Node.js runtimes). Supabase Cloud for managed Postgres and auth services.
- **Scale and performance requirements:** Early-stage SaaS supporting tens to low hundreds of concurrent users. Supabase connection pooling and Vercel's edge network handle initial scale. Architecture should support horizontal scaling without major refactoring.

## 2. Open Questions & Clarifications

None — all critical decisions are resolved.

## 3. Core Technology Stack

### Programming Languages

- **Primary language:** TypeScript (strict mode enabled)
  - **Rationale:** Type safety across the full stack (frontend + API routes + database queries). Reduces bugs, improves IDE support, and is the standard for modern Next.js development.
- **Language-specific tooling:**
  - ESLint for linting (with `@next/eslint-plugin-next`)
  - Prettier for formatting
  - `typescript` compiler in strict mode (`strict: true` in `tsconfig.json`)

### Runtime Environment

- **Runtime:** Node.js 20 LTS
- **Package manager:** pnpm
  - **Rationale:** Faster installs, strict dependency resolution (prevents phantom dependencies), disk-efficient via content-addressable storage. Well-supported by Vercel.
- **Container runtime:** Not applicable — deployed as serverless functions on Vercel. Docker used only for local Supabase development via `supabase start`.

## 4. Frontend Stack

### Framework

- **Framework:** Next.js 15 (App Router)
  - **Rationale:** React-based full-stack framework with server components, server actions, and API routes in a single project. First-class Vercel deployment support. App Router enables streaming, partial prerendering, and co-located data fetching.
- **React version:** React 19 (ships with Next.js 15)
- **Update strategy:** Stay on latest stable Next.js minor releases. Evaluate major upgrades within 2 weeks of release.

### Build Tools

- **Bundler:** Turbopack (Next.js built-in, used in development)
- **Production builds:** Next.js built-in compiler (SWC-based)
- **No additional bundler configuration needed** — Next.js handles transpilation, code splitting, tree shaking, and minification out of the box.

### State Management

- **Server state:** React Server Components for initial data loading. `@supabase/ssr` for authenticated server-side data fetching.
- **Client state:** React's built-in state (`useState`, `useReducer`, `useContext`) for local UI state. No external state management library needed at this stage.
- **Data fetching on the client:** Supabase client library for real-time subscriptions and client-initiated mutations. Consider adding `swr` or `@tanstack/react-query` only if caching/revalidation patterns become complex.

### Styling Technology

- **CSS framework:** Tailwind CSS v4
  - **Rationale:** Utility-first approach enables rapid UI development. Excellent tree-shaking keeps bundle size small.
- **Component library:** shadcn/ui
  - **Rationale:** Copy-paste component primitives built on Radix UI. Fully customizable (not a locked dependency), accessible by default, designed for Tailwind. Components live in the codebase, not `node_modules`.
- **Design token mapping:** Tailwind's CSS custom properties (defined in `app/globals.css`) serve as the bridge between design tokens documented in `gspec/style.md` and utility classes. shadcn/ui's theming uses these same CSS variables for consistent styling.
- **Note**: Icon library choices are defined in `gspec/style.md`. The stack defines the CSS framework and component library; the style defines the icon set.

### Progressive Web App

- **PWA implementation:** `next-pwa` (or `@serwist/next`) for service worker generation and caching.
- **Manifest:** `manifest.json` in the `public/` directory with app name, icons, theme color, and display mode (`standalone`).
- **Offline strategy:** Cache-first for static assets. Network-first for API calls with fallback to cached data where appropriate.
- **Install prompt:** Native browser install prompt. No custom install UI for MVP.

## 5. Backend Stack

### Framework

- **API layer:** Next.js Route Handlers (App Router `route.ts` files) for application API endpoints.
- **API style:** RESTful JSON APIs via Route Handlers. Supabase client SDK used directly in Server Components and Server Actions for database operations where no custom API logic is needed.
- **Server Actions:** Used for form mutations and simple data writes that don't need a formal API endpoint.

### Database

- **Primary database:** Supabase Postgres (managed PostgreSQL)
  - **Rationale:** Managed Postgres with built-in auth, Row Level Security, real-time subscriptions, and a generous free tier. Eliminates the need for a separate auth service and reduces infrastructure complexity.
- **ORM / query builder:** Supabase JavaScript client (`@supabase/supabase-js`) for data access. Supabase auto-generates a typed client from the database schema.
  - **Type generation:** Use `supabase gen types typescript` to generate TypeScript types from the database schema. Regenerate after every migration.
- **Migration strategy:** Supabase CLI migrations (`supabase migration new`, `supabase db push`). Migrations are SQL files stored in `supabase/migrations/` and version-controlled in git.
- **Connection pooling:** Supabase's built-in Supavisor connection pooler (transaction mode) for serverless function compatibility.

### Row Level Security (RLS)

- **RLS is mandatory on all tables.** Every table must have RLS enabled with appropriate policies before being used by the application.
- **Policy design:** Policies use `auth.uid()` to scope data access to the authenticated user's resources. Multi-tenant isolation is enforced at the database level, not the application level.
- **Service role:** The Supabase service role key is used only in server-side contexts (Route Handlers, Server Actions) when RLS bypass is explicitly needed (e.g., admin operations, background jobs). Never expose the service role key to the client.

### Caching Layer

- **No dedicated caching service for MVP.** Leverage:
  - Next.js Data Cache and `revalidatePath`/`revalidateTag` for server-side caching
  - Vercel Edge Cache for static and ISR pages
  - Browser caching via service worker (PWA)
- **Upgrade path:** Add Redis (Upstash) if query patterns demand it post-launch.

### Message Queue / Event Bus

Not applicable for MVP. Background jobs (e.g., scheduled reports, data syncs) will use Vercel Cron to trigger Next.js Route Handlers on a schedule. This keeps all code in the single Next.js codebase. Upgrade to a dedicated queue if job volume or complexity warrants it.

## 6. Infrastructure & DevOps

### Cloud Provider

- **Primary:** Vercel for application hosting and edge network.
- **Database & Auth:** Supabase Cloud (runs on AWS under the hood).
- **Key services used:**
  - Vercel: Serverless Functions, Edge Network, Preview Deployments, Analytics
  - Supabase: Postgres, Auth, Realtime, Edge Functions, Storage (for file uploads if needed)

### Container Orchestration

Not applicable — fully serverless architecture. Vercel manages function scaling and routing. Supabase manages database scaling.

### CI/CD Pipeline

- **Platform:** GitHub Actions
  - *Rationale:* Native GitHub integration for PRs and branch workflows. Pairs well with Vercel's GitHub integration for preview deployments.
- **Deployment trigger:** Merge to `main` branch.
- **Deployment method:** Vercel GitHub integration — automatic preview deploys on every PR, production deploy on merge to `main`.
- **Database migrations:** Applied manually via `supabase db push` or automated in the deploy pipeline for production.
- **Branch strategy:** Feature branches → PR → merge to `main` → auto-deploy to production.
- **Note:** Pipeline stages and structure (lint → typecheck → test → build → deploy) are defined in `gspec/practices.md`. This section defines the CI technology and deployment configuration.

### Infrastructure as Code

- **Supabase configuration:** `supabase/config.toml` for local dev settings. SQL migrations in `supabase/migrations/` for schema changes.
- **Vercel configuration:** `vercel.json` for redirects, headers, and function configuration. Environment variables managed via Vercel dashboard and `vercel env pull` for local dev.
- **No dedicated IaC tool** (Terraform, etc.) needed at this stage — both Vercel and Supabase are fully managed.

## 7. Data & Storage

### File Storage

- **Object storage:** Supabase Storage for user-uploaded files (e.g., business logos, report assets).
- **CDN:** Vercel Edge Network for static assets. Supabase Storage has built-in CDN via its transformation API.
- **Asset management:** Static assets (images, fonts, icons) in `public/` directory, served via Vercel's CDN.

### Data Warehouse / Analytics

Not applicable for MVP. Analytics via Vercel built-in analytics. Revisit when reporting features require historical data aggregation.

## 8. Authentication & Security

### Authentication

- **Auth provider:** Supabase Auth
  - **Rationale:** Tightly integrated with Supabase Postgres and RLS. Supports email/password, magic links, and OAuth providers. Free tier is generous.
- **Authentication flow:**
  - Email/password with email confirmation
  - Magic link login as an alternative
  - Google OAuth for quick signup
  - Session management via Supabase Auth cookies (using `@supabase/ssr` for server-side session handling)
- **Custom login pages:** All auth UI is custom-built using shadcn/ui components. No Supabase-branded auth UI (`@supabase/auth-ui-react`) is used. Auth flows call `supabase.auth.signInWithPassword()`, `signUp()`, etc. directly.
- **Identity management:** Supabase Auth handles user records. Application-level user profiles stored in a `profiles` table linked to `auth.users` via foreign key.

### Authorization

- **Pattern:** Row Level Security (RLS) at the database layer for data access control. Application-level role checks for UI and API authorization.
- **Roles:** Users belong to organizations. Roles (e.g., owner, member) are stored in a membership table and checked in RLS policies and server-side logic.
- **Permission management:** RLS policies are the primary enforcement mechanism. Server-side middleware validates session and role before processing sensitive operations.

### Security Tools

- **Secrets management:** Environment variables stored in Vercel (production) and `.env.local` (development, git-ignored). Supabase service role key and other sensitive values never committed to source control.
- **Security headers:** Configured via `next.config.ts` security headers (CSP, HSTS, X-Frame-Options, etc.) and Vercel's built-in protections.
- **Dependency scanning:** Dependabot or Renovate for automated dependency updates. `pnpm audit` in CI pipeline.

## 9. Monitoring & Observability

### Application Monitoring

- **Primary:** Vercel Analytics (Web Vitals, page performance, function execution times).
- **Speed Insights:** Vercel Speed Insights for real-user Core Web Vitals monitoring.
- **Product analytics:** Google Analytics 4 (GA4) for user behavior tracking, acquisition channels, and conversion funnels. Integrated via `@next/third-parties` Google tag support for optimal Next.js compatibility (script loading, route change tracking). Measurement ID stored as a `NEXT_PUBLIC_GA_MEASUREMENT_ID` environment variable.
- **Upgrade path:** Add Sentry or Datadog if error volume or debugging complexity warrants it post-launch.

### Logging

- **Application logs:** `console.log` / `console.error` in server functions, captured by Vercel's built-in log drain.
- **Supabase logs:** Available via Supabase Dashboard (Postgres logs, Auth logs, Edge Function logs).
- **Structured logging:** Use a lightweight structured logger (e.g., `pino`) if log volume grows and needs parsing.

### Tracing

Not applicable for MVP — single-service architecture doesn't require distributed tracing. Vercel function logs provide request-level visibility.

### Error Tracking

- **Primary:** Vercel's built-in error reporting for function errors and build failures.
- **Client-side:** React Error Boundaries for graceful UI error handling. Errors logged to console and visible in Vercel logs.
- **Upgrade path:** Add Sentry for structured error tracking with stack traces and release correlation.

## 10. Testing Infrastructure

### Testing Frameworks

- **Unit & integration testing:** Vitest
  - **Rationale:** Fast, Vite-native, excellent TypeScript support, Jest-compatible API. Runs significantly faster than Jest for modern TypeScript projects.
- **E2E testing:** Playwright
  - **Rationale:** Cross-browser support, reliable auto-waiting, excellent developer tooling (codegen, trace viewer). Runs against actual Vercel preview deployments.
- **Component testing:** Vitest with `@testing-library/react` for testing React components in isolation.

### Test Data Management

- **Test database:** Local Supabase instance via `supabase start` (Docker-based) for integration tests.
- **Fixtures:** SQL seed files in `supabase/seed.sql` for consistent test data.
- **Mocking:** Vitest's built-in mocking for unit tests. MSW (Mock Service Worker) for mocking external API calls in integration tests.

### Performance Testing

Not applicable for MVP. Add load testing (k6 or similar) when approaching production scale.

## 11. Third-Party Integrations

### External Services

### API Clients

- **HTTP client:** Native `fetch` API (available in Node.js 20+ and Next.js server contexts). No Axios dependency needed.
- **SDK usage:** Use official SDKs where available (e.g., Google APIs client library). Fall back to `fetch` for APIs without official TypeScript SDKs.
- **API versioning:** Pin external API versions where possible. Abstract third-party API calls behind internal service modules to isolate breaking changes.

## 12. Development Tools

### Package Management

- **Package manager:** pnpm (v9+)
- **Dependency strategy:** Pin exact versions in `pnpm-lock.yaml`. Use `pnpm up --latest` for controlled upgrades. Automated dependency PRs via Dependabot or Renovate.
- **Private registry:** Not applicable.

### Code Quality Tools

- **Linter:** ESLint with `@next/eslint-plugin-next`, `eslint-plugin-react-hooks`, and `typescript-eslint`
- **Formatter:** Prettier (integrated with ESLint via `eslint-config-prettier`)
- **Pre-commit hooks:** `lint-staged` + `husky` for running lint and format checks on staged files before commit

### Local Development

- **Local environment:**
  - `pnpm dev` — Next.js dev server with Turbopack
  - `supabase start` — Local Supabase stack (Postgres, Auth, Storage, Realtime) via Docker
  - `.env.local` — Local environment variables (Supabase URL, anon key, etc.)
- **Database GUI:** Supabase Studio (included with `supabase start`, available at `localhost:54323`)
- **Hot reload:** Turbopack provides fast refresh for frontend changes. Server-side changes auto-restart.

## 13. Migration & Compatibility

### Legacy System Integration

Not applicable — greenfield project with no legacy systems.

### Upgrade Path

- **Next.js:** Follow Vercel's upgrade guides for major versions. Canary testing on preview branches before upgrading production.
- **Supabase:** Managed upgrades handled by Supabase Cloud. Test migration compatibility against local Supabase instance before applying to production.
- **Breaking change management:** Automated dependency update PRs. CI pipeline catches regressions before merge.

## 14. Technology Decisions & Tradeoffs

### Key Architectural Decisions

| Decision | Rationale | Alternative Considered | Tradeoff |
|---|---|---|---|
| **Next.js App Router** | Server components, streaming, co-located data fetching. Vercel-optimized. | Pages Router | App Router is newer with some rough edges, but is the future of Next.js |
| **Supabase over custom backend** | Managed Postgres + Auth + Realtime eliminates boilerplate. RLS provides multi-tenant security at the DB layer. | Separate API server + Auth0 + managed Postgres | Less flexibility in auth flows and background job processing, but dramatically faster to ship |
| **shadcn/ui over a component library** | Components live in the codebase, fully customizable. No version lock-in. | MUI, Chakra, Mantine | More initial setup than a batteries-included library, but better long-term control |
| **Custom auth pages over Supabase Auth UI** | Full brand control, no Supabase branding, custom UX | `@supabase/auth-ui-react` | More code to maintain, but necessary for professional SaaS appearance |
| **Vercel over self-hosted** | Zero-config deploys, preview environments, edge network, analytics. | AWS (ECS/Lambda), Fly.io | Vendor lock-in to Vercel, higher costs at scale. Acceptable for early stage. |
| **RLS over application-level authorization** | Security enforced at DB layer — no way to accidentally bypass in application code | Middleware-only auth checks | RLS policies are harder to debug and test. Worth it for multi-tenant data isolation. |

### Risk Mitigation

- **Vercel vendor lock-in:** Next.js is open source and can be self-hosted. Migration path exists if Vercel costs become prohibitive.
- **Supabase availability:** Supabase is backed by standard Postgres. Data can be migrated to any Postgres host. Auth can be replaced with a custom solution or another provider.
- **Serverless cold starts:** Vercel's edge runtime and function warm-up mitigate most cold start issues. Monitor function execution times via Vercel Analytics.

## 15. Technology-Specific Practices

### Framework Conventions & Patterns

- **App Router structure:** Use the `app/` directory with route groups for logical organization (e.g., `(auth)` for login/signup, `(dashboard)` for authenticated pages, `(marketing)` for public pages).
- **Server vs Client Components:** Default to Server Components. Add `"use client"` only when the component needs browser APIs, event handlers, or React hooks (`useState`, `useEffect`).
- **Data fetching:** Fetch data in Server Components or Server Actions. Avoid `useEffect` for data fetching on the client. Use Supabase's real-time subscriptions for live updates on the client.
- **Route Handlers:** Use `app/api/` route handlers only for webhook endpoints, external API integrations, or operations that need explicit HTTP method handling. Prefer Server Actions for form mutations.
- **Loading and error states:** Use `loading.tsx` and `error.tsx` files at appropriate route levels for streaming UI and error boundaries.

### Library Usage Patterns

- **Supabase client initialization:**
  - Server Components / Server Actions: Create a Supabase client per-request using `@supabase/ssr` with cookie-based session handling
  - Client Components: Create a browser client using `createBrowserClient` from `@supabase/ssr`
  - Route Handlers: Create a server client with cookie access
  - Never instantiate the service role client on the client side
- **shadcn/ui usage:** Components installed into `components/ui/`. Customize via the CSS variables in `globals.css`, not by modifying component internals directly unless necessary. Compose complex UI from shadcn primitives.
- **Tailwind conventions:** Use Tailwind utility classes directly in JSX. Avoid `@apply` except in `globals.css` for base styles. Use `cn()` utility (from shadcn) for conditional class merging. Follow mobile-first responsive design (`sm:`, `md:`, `lg:` breakpoints).

### Language Idioms

- **TypeScript strict mode:** `strict: true` in `tsconfig.json`. No `any` types except in genuinely dynamic contexts. Use `unknown` and narrow with type guards.
- **Import organization:** Group imports in order: (1) React/Next.js, (2) third-party libraries, (3) internal modules, (4) relative imports. Enforce with ESLint import ordering rules.
- **Path aliases:** Use `@/` alias (configured in `tsconfig.json`) for imports from the project root. Example: `import { Button } from "@/components/ui/button"`.
- **Async patterns:** Use `async/await` consistently. Avoid `.then()` chains. Handle errors with try/catch in Server Actions and Route Handlers.

### Stack-Specific Anti-Patterns

- **Do not use the Supabase service role key in Client Components or expose it via environment variables prefixed with `NEXT_PUBLIC_`.** This bypasses RLS and is a critical security vulnerability.
- **Do not disable RLS on tables**, even temporarily. Create permissive policies for development if needed, but never turn RLS off.
- **Do not use `useEffect` for data fetching** when a Server Component or Server Action can do the same work. This leads to client-side waterfalls and loading spinners.
- **Do not import server-only modules in Client Components.** Use the `server-only` package to enforce boundaries.
- **Do not store Supabase sessions in localStorage.** Use `@supabase/ssr` cookie-based session handling for secure, server-compatible auth.
- **Avoid excessive `"use client"` directives.** Push interactivity to leaf components and keep parent layouts as Server Components for better performance and smaller client bundles.
