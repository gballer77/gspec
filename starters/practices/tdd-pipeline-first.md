---
gspec-version: 1.8.0
description: TDD, pipeline-first CI/CD, DRY principles, and clean code standards
---

# Development Practices Guide

## 1. Overview

**Context**: This guide serves as the strict instruction set for AI agents and developers working on the project.
**Goal**: Maintain a high-velocity, high-quality codebase through rigorous adherence to Test-Driven Development (TDD), DRY principles, and clean code standards.

> **Precedence rule**: Where this document conflicts with technology-specific practices in `gspec/stack.md`, the stack's technology-specific practices take precedence for framework-specific concerns (e.g., file naming conventions dictated by a framework, framework-specific component patterns). This document governs general engineering principles.
>
> **Tooling authority**: This document defines testing *philosophy* (TDD, coverage targets, test organization). The specific testing *tools* (Vitest, Playwright, Cypress, etc.) are defined in `gspec/stack.md`. This document defines CI/CD pipeline *structure* (stages, gates, ordering). The specific CI/CD *platform* (GitHub Actions, GitLab CI, etc.) is defined in `gspec/stack.md`.

## 2. Core Development Practices

### Pipeline-First Development

> [!IMPORTANT]
> **The CI/CD pipeline MUST be established immediately after scaffolding the project, before any application-specific features are implemented.**
> A working pipeline is the foundation that validates every subsequent change.

#### Implementation Order

After the initial project scaffold (framework setup, dependency installation, basic configuration), the following must be completed in order:

1.  **Lint stage**: Configure the project's linter and formatter. Verify linting passes on the scaffolded codebase.
2.  **Typecheck stage**: Ensure static type checking passes with strict mode enabled.
3.  **Test stage**: Set up the unit test runner (as specified in `gspec/stack.md`) with a single trivial passing test (e.g., a smoke test that asserts `true`). Configure the E2E test runner (as specified in `gspec/stack.md`) with a minimal test that loads the index page. Both unit and E2E test commands must pass.
4.  **Build stage**: Confirm the production build completes successfully.
5.  **CI pipeline**: Configure the CI/CD platform (as specified in `gspec/stack.md`) with pipeline stages for lint, typecheck, test, build, and deploy. The pipeline must pass end-to-end on the scaffolded project before any feature work begins.

#### Acceptance Criteria

*   All pipeline stages are configured and green.
*   The pipeline runs automatically on every push and merge request.
*   Pre-commit hooks are installed and functional, running the linter and formatter on staged files.
*   No feature branch may be started until the pipeline is verified on the default branch.

#### Rationale

*   **Catch regressions from the first commit**: Every change, no matter how small, is validated.
*   **Avoid pipeline debt**: Retrofitting CI/CD after features are built leads to a batch of failures that are harder to triage.
*   **Enforce quality gates early**: Developers and AI agents build the habit of writing code that passes all checks from day one.

### Testing Standards (TDD)

> [!IMPORTANT]
> **Test-Driven Development (TDD) is MANDATORY.**
> Strict adherence to the Red-Green-Refactor cycle is required for all logic changes.

1.  **Red**: Write a failing test for the smallest possible unit of functionality.
2.  **Green**: Write the minimum amount of code required to pass the test.
3.  **Refactor**: Improve the code structure without changing behavior, ensuring tests remain green.

*   **Scope**:
    *   **Unit Tests**: Required for all utility functions, helpers, and complex components. Target 100% coverage for business logic.
    *   **Integration Tests**: Required for API routes and critical user flows.
    *   **End-to-End Tests**: Headless E2E tests are required for all critical pages to verify they load and render correctly. These tests ensure that routing, layout rendering, and key UI elements are functional from the user's perspective.
*   **Location**: Dedicated `tests/` directory at the project root or module level, mirroring the source structure. DO NOT colocate tests with source files. E2E tests live in a separate directory (e.g., `e2e/`).
*   **Naming**: `[filename].spec.*` exclusively. E2E tests use `[page-name].spec.*`.
*   **E2E Configuration**:
    *   **Headless by default**: All E2E tests MUST run in headless mode in CI and during standard test runs.
    *   **Critical Page Coverage**: Every user-facing route must have at minimum a "page loads successfully" E2E test that asserts the page renders without errors and key elements are visible.
    *   **No Flaky Tests**: E2E tests must be deterministic. Stub external API calls where needed to avoid flakiness.

### Code Quality Standards

#### DRY (Don't Repeat Yourself)
*   **Rule**: Do not duplicate business logic or complex styling.
*   **Action**: Extract reusable logic into shared functions, helpers, or modules.
*   **Exceptions**: Minor duplication (3-4 lines) is acceptable if abstraction increases complexity significantly (WET - Write Everything Twice, but not thrice).

#### Nesting & Complexity
*   **Max Nesting Depth**: 3 levels.
    *   *Violation*: `if (...) { for (...) { if (...) { ... } } }`
    *   *Fix*: Extract the inner logic into a named private function or guard clause.
*   **Function Length**: Keep functions under 30 lines where possible. Single Responsibility Principle (SRP) applies strictly.
*   **Cognitive Load**: Use "Early Return" pattern to reduce indentation.

### Code Organization

#### Typing & Safety
*   **Strict Typing**: If the project uses a statically typed language, enable the strictest available type checking mode. Avoid escape hatches (e.g., `any` in TypeScript, `Object` in Java) — use narrower types or generics instead.

#### Naming Conventions
*   **Variables/Properties**: `camelCase` (e.g., `userProfile`, `isValid`)
*   **Functions**: `camelCase` (e.g., `calculateTotal`, `fetchUserData`)
*   **Types/Interfaces/Classes**: `PascalCase` (e.g., `UserProfile`, `AuthResponse`)
*   **Constants**: `UPPER_SNAKE_CASE` for global constants (e.g., `MAX_RETRY_COUNT`); `camelCase` for local constants.
*   **Files**: `kebab-case` (e.g., `user-profile`) for general source files; `PascalCase` for component files where idiomatic for the framework.
*   **Descriptive Naming**:
    *   *Bad*: `val = getData(d)`
    *   *Good*: `userProfile = fetchUserProfile(date)`
    *   Boolean variables should ideally be prefixed with `is`, `has`, `should` (e.g., `isValid`, `hasAccess`).

#### File Structure
*   **Colocation**: Keep related files together (e.g., component, test, and styles if utilizing modules).
*   **Barrels**: Use index/barrel files sparingly to export the public API of a module.

## 3. Version Control & Collaboration

### Git Practices
*   **Commits**: Conventional Commits style (e.g., `feat: add login page`, `fix: resolve auth timeout`).
*   **Branches**: `feat/feature-name`, `fix/issue-description`, `chore/maintenance`.

### Code Review Standards

To be defined.

## 4. Documentation Requirements

*   **Self-Documenting Code**: Prioritize clear naming over comments.
*   **Comments**: Use comments *only* to explain "Why", not "What".
    *   *Bad*: `// increment i by 1`
    *   *Good*: `// Retry logic required due to potential API race condition`
*   **API Documentation**: Use the language's standard doc comment format for public utility functions and complex interfaces to provide IDE hints.
*   **Deployment Guide**: A `DEPLOYMENT.md` file MUST exist at the project root with step-by-step instructions covering:
    *   **SaaS Product Configuration**: Account setup and configuration for every third-party service the project depends on. Include required environment variables, API keys, webhook URLs, and any dashboard settings that must be configured.
    *   **Infrastructure Setup**: Instructions for provisioning hosting, databases, DNS, CDN, and any other infrastructure components.
    *   **Environment Variables**: A complete list of all required environment variables with descriptions, expected formats, and where to obtain each value.
    *   **Build & Deploy Steps**: Commands and procedures to build and deploy the application to production, including any CI/CD pipeline configuration.
    *   **Post-Deploy Verification**: Checklist of smoke tests and health checks to confirm a successful deployment.
    *   **Rollback Procedure**: Steps to revert to the previous version if a deployment fails.
    *   Keep `DEPLOYMENT.md` updated whenever a new SaaS dependency is added or deployment steps change.

## 5. Error Handling & Logging

*   **Pattern**: Use error boundaries or equivalent mechanisms to catch and handle UI errors gracefully.
*   **Backend**: Use structured error objects. Avoid throwing raw strings or untyped errors.
*   **Logging**: Log significant state changes and errors. Do not leave debugging log statements in production code.

## 6. Performance & Optimization

*   **Rendering**: Memoize or cache expensive computations only when profiling shows a measurable benefit. Virtualize long lists to avoid rendering off-screen items.
*   **Images**: Always use optimized image components or pipelines provided by the framework.

### SEO & Discoverability

> [!IMPORTANT]
> **SEO is a core product requirement, not an afterthought.**
> Every page should be optimized for search engines and social sharing.

#### Metadata Standards
*   Every page must export metadata including title, description, and Open Graph tags.
*   **Title Format**: `[Page Name] - [Site Name]` (max 60 characters)
*   **Description**: 120-160 characters, include primary keyword naturally
*   **Open Graph**: Always include `title`, `description`, and `images` for social sharing

#### Technical SEO
*   **Semantic HTML**: Use proper heading hierarchy (`h1` → `h2` → `h3`). One `h1` per page.
*   **Image Alt Text**: All images MUST have descriptive `alt` attributes.
    *   *Bad*: `alt="image"`
    *   *Good*: `alt="Professional reviewing code on laptop screen"`
*   **Structured Data**: Add JSON-LD schema markup where applicable.
*   **Sitemap**: Keep `sitemap.xml` updated via dynamic sitemap generation.
*   **Robots.txt**: Configure properly to allow indexing of public pages, block admin/auth routes.

#### Performance for SEO
*   **Core Web Vitals**: Monitor and optimize for LCP, FID, CLS.
    *   Use optimized image components with priority for above-fold images
    *   Lazy load below-fold content
*   **Mobile-First**: All pages must be responsive and mobile-friendly (Google mobile-first indexing).
*   **Page Speed**: Target < 3s initial load on 3G connections.

#### Content Guidelines
*   **URLs**: Use descriptive, keyword-rich slugs
    *   *Good*: `/services/web-development`
    *   *Bad*: `/s/123`
*   **Internal Linking**: Link related content naturally using descriptive anchor text.
*   **Heading Structure**: Front-load important keywords in headings without keyword stuffing.

## 7. Security Practices

*   **Input Validation**: Validate all external inputs (API params, form data) using a schema validation library.
*   **Authentication**: Never implement custom crypto. Use an established auth provider.
*   **Authorization**: Verify user permissions on *every* server action/API route.

## 8. Refactoring Guidelines

*   **Boy Scout Rule**: Always leave the code cleaner than you found it.
*   **Refactor Step**: In TDD, the refactor step is not optional. It is the moment to apply DRY and clean up nesting.

## 9. Definition of Done

1.  [ ] Tests written (red -> green).
2.  [ ] Code follows style guide (linted & formatted).
3.  [ ] No new Type errors.
4.  [ ] Logic extracted and readable.

