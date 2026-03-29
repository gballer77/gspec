---
gspec-version: 1.8.0
description: Site footer with nav links, social icons, and copyright
---

# Site Footer

## Overview

A standard informational footer rendered at the bottom of every page, providing consistent brand identity, copyright information, and site-wide navigation and legal links. Without a persistent footer, visitors lack a reliable anchor for finding key links and verifying they are on a legitimate, professional site — reducing trust and increasing navigation friction.

## Users & Use Cases

**Primary users:** All site visitors, regardless of their entry point or intent.

**Key use cases:**

1. A visitor reaches the bottom of any page and wants to navigate to another section of the site without scrolling back to the top — the footer provides quick links to key pages.
2. A visitor wants to review legal or policy information (privacy policy, terms of use) and looks to the footer as the conventional location for these links.
3. A first-time visitor glances at the footer to confirm the business identity, read a brief description, and see a copyright notice — reinforcing legitimacy and professionalism.

## Scope

**In scope:**

- Business identity display (name and short tagline or description)
- Copyright notice with current year
- Navigation links to main site pages
- Legal and support links (privacy policy, terms of use, accessibility)
- Consistent rendering across all pages
- Responsive layout across device sizes

**Out of scope:**

- Contact forms, email signup forms, or interactive input elements
- Embedded maps or dynamic content
- Page-specific content or messaging that varies by page
- CMS or admin interface for managing footer content

**Deferred ideas:**

- Social media profile icon links
- Certification badges or trust seals
- Micro-CTA buttons (e.g., "Get a Quote")
- Newsletter signup field
- Secondary tagline or seasonal messaging

## Capabilities

- [ ] **P0**: Footer displays the business name and a short tagline or description
  - Business name is visible and prominent within the footer
  - A brief tagline or description (1 sentence) accompanies the name
  - Identity text is legible at all viewport sizes

- [ ] **P0**: Footer displays a copyright notice
  - Copyright notice includes the current year and business name
  - Notice is positioned in a conventional footer location (typically bottom of the footer)
  - Text is legible but visually secondary to navigation and identity content

- [ ] **P0**: Footer includes navigation links to main site pages
  - Links to all primary site pages (Home, About, Contact) are present
  - Links are clearly labeled with readable text
  - Each link navigates to the correct page when activated

- [ ] **P0**: Footer includes legal and support links
  - Links for privacy policy, terms of use, and accessibility statement are present
  - Legal links are visually grouped or separated from main navigation links to indicate their distinct purpose
  - Each link navigates to the correct destination when activated

- [ ] **P0**: Footer renders consistently on every page
  - The footer appears at the bottom of the page content on all site pages
  - Footer content and layout are identical regardless of which page the visitor is on
  - Footer does not overlap or interfere with page-specific content or sticky navigation elements

- [ ] **P0**: Footer is fully responsive across common device sizes
  - Layout adapts cleanly to desktop (1024px+), tablet (768px), and mobile (375px) viewports
  - No horizontal scrolling caused by the footer on any viewport
  - Links remain legible and tappable (adequate touch target size) on mobile devices

- [ ] **P1**: Footer content is organized with clear visual hierarchy
  - Business identity, navigation links, legal links, and copyright are visually distinct sections or groups
  - A visitor can distinguish between navigation and legal links without reading every label
  - Layout uses spacing and grouping to prevent the footer from feeling cluttered

- [ ] **P2**: Footer structure supports accessibility
  - Footer uses a semantic landmark element so assistive technologies can identify it
  - All links are keyboard-navigable and have accessible labels
  - Sufficient color contrast for all text and link elements

## Dependencies

- **Home Page** ([home-page.md](home-page.md)): Footer navigation links include a link to the home page.
- **About Page** ([about-page.md](about-page.md)): Footer navigation links include a link to the about page.
- **Contact Page** ([contact-page.md](contact-page.md)): Footer navigation links include a link to the contact page.

Note: The footer can be built before these pages exist by using placeholder destinations. The dependency is on the link targets being available at launch.

## Assumptions & Risks

**Assumptions:**

- The business has an established name and can provide a short tagline or description for footer use.
- Legal pages (privacy policy, terms of use, accessibility statement) will exist as link destinations by launch, even if as simple placeholder pages.
- Footer content (identity info, links) is stable and changes infrequently; developer-managed updates are acceptable.
- A single, shared footer is sufficient — no page-specific footer variations are needed.

**Key risks:**

- **Legal page readiness:** The footer links to legal pages that may not yet exist. Mitigation: links can point to placeholder pages during development; the footer layout is not blocked by legal content.
- **Navigation consistency with header:** If a separate header or navigation bar exists, the footer's navigation links must stay in sync. Mitigation: both should draw link destinations from a shared configuration or data source to avoid drift.

## Success Metrics

1. The footer is present and visually consistent on every page of the site.
2. All footer links (navigation and legal) navigate to their correct destinations without errors.
3. Visitors can identify the business name and find at least one navigation link within 3 seconds of viewing the footer.
4. The footer renders correctly across desktop, tablet, and mobile viewports with no layout issues.

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
