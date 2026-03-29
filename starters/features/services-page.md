---
gspec-version: 1.8.0
description: Service offerings with descriptions, icons, and pricing tiers
---

# Services Page

## Overview

A dedicated Services page that presents the business's service offerings in detail beyond the brief overview on the home page. Prospective clients who are evaluating whether the business can meet their specific needs require more than a one-line summary — this page gives each service enough space to communicate what it involves and why it matters, helping visitors self-qualify before making contact.

## Users & Use Cases

**Primary users:** Prospective clients evaluating the business's service offerings in detail.

**Key use cases:**

1. A prospective client clicks through from the home page services overview to understand a specific service in more depth before deciding to reach out.
2. A visitor comparing multiple firms reviews the Services page to assess breadth and relevance of offerings against their needs.
3. A referral who was told the business handles a specific type of work visits the Services page to confirm that service is offered and understand what it entails.

## Scope

**In scope:**

- Individual section for each service with a heading and short descriptive paragraph (3-5 sentences)
- Introductory text at the top of the page framing the overall service offering
- Support for 3-6 service items
- Responsive layout that works across desktop, tablet, and mobile devices
- Static content coded directly into the page

**Out of scope:**

- Pricing, rates, or cost information
- Calls-to-action, contact forms, or conversion elements (handled by a separate feature)
- Individual dedicated pages per service
- Case studies, project examples, or portfolio items tied to services
- Dynamic or CMS-managed content
- Filtering, search, or categorization of services

**Deferred ideas:**

- Individual service detail pages linked from each service section
- Icons or illustrations accompanying each service
- Client testimonials or case studies associated with specific services
- Service comparison table or feature matrix
- FAQ section addressing common questions about the services

## Capabilities

- [ ] **P0**: Page displays an introductory section framing the overall service offering
  - Section includes a heading and a brief paragraph (1-3 sentences) that sets context for the services listed below
  - Introductory text is visible immediately on page load without scrolling on desktop viewports
  - Section is visually distinct from the individual service sections

- [ ] **P0**: Each service is presented with a heading and descriptive paragraph
  - Each service has a clear, distinct heading (service name)
  - Each service includes a descriptive paragraph of 3-5 sentences explaining what the service involves and the value it provides
  - Services are presented in a consistent, repeatable layout pattern
  - The page accommodates 3-6 services without feeling cluttered or requiring excessive scrolling

- [ ] **P0**: Page is fully responsive across common device sizes
  - Layout adapts cleanly to desktop (1024px+), tablet (768px), and mobile (375px) viewports
  - No horizontal scrolling on any viewport
  - Text remains readable and sections are well-spaced at all sizes

- [ ] **P1**: Services are visually scannable and well-structured
  - A visitor can identify all available services by name within 10 seconds of viewing the page
  - Each service section is visually separated from adjacent sections with adequate spacing
  - Clear visual hierarchy distinguishes service headings from descriptive text

- [ ] **P2**: Semantic page structure supports accessibility
  - Page uses proper heading hierarchy (single h1, logical h2/h3 nesting)
  - Content is navigable via keyboard
  - Sufficient color contrast for all text elements

## Dependencies

- **Home Page** ([home-page.md](home-page.md)): The home page includes a services overview section. The Services page expands on that overview. Navigation between pages should be consistent, and the home page services section should link to this page for visitors wanting more detail.

## Assumptions & Risks

**Assumptions:**

- The business has 3-6 defined service offerings that can each be described in 3-5 sentences.
- Service offerings are stable and change infrequently; developer-managed updates are acceptable.
- The brief home page services overview is sufficient as a summary, and this page serves as the next level of detail without needing individual service pages.

**Key risks:**

- **Content readiness:** Each service requires a descriptive paragraph beyond what the home page provides. Mitigation: use realistic placeholder content during development so layout and structure can be validated independently.
- **Redundancy with home page:** Visitors may feel the Services page duplicates the home page overview if the additional detail is not meaningfully different. Mitigation: ensure the home page overview uses shorter summaries (1-2 sentences) while this page provides fuller descriptions (3-5 sentences) with distinct value-oriented content.

## Success Metrics

1. Visitors can identify all available services by name within 10 seconds of viewing the page.
2. Each service description provides enough detail that a visitor can determine whether the service is relevant to their needs without contacting the business.
3. The page renders correctly and is fully usable across desktop, tablet, and mobile viewports.
4. All service sections display in a consistent layout without visual issues or excessive whitespace.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
