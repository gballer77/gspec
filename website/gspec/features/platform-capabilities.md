---
spec-version: v1
---

# Platform Capabilities

## Overview

A dedicated page that shows, harness by harness, which gspec capabilities each supported AI coding tool can deliver — and where the gaps are. gspec works across many harnesses, but they are not equivalent: some enforce spec integrity with hard, deterministic guarantees while others can only offer the same conventions as guidance, and support for the autonomous build and the learning loop varies by tool.

Prospective and current users need to make an informed choice of harness (or set the right expectations for the one they already use). Today that disparity is invisible — the marketing surface implies uniform "works everywhere" support, which oversells weaker harnesses and undersells the strongest. A capability comparison page makes the real differences legible so users can pick the right tool for the guarantees they need.

## Users & Use Cases

**Primary users:** Developers deciding which AI coding harness to use with gspec, and existing users calibrating what to expect from their current harness.

1. **Choosing a harness before adopting** — A developer evaluating gspec wants the strongest enforcement and learning guarantees. They scan the comparison and see which harness delivers full-fidelity support.
2. **Setting expectations for an existing tool** — A developer already committed to a harness checks which capabilities they get and which are advisory-only, so they know where to compensate with manual review.
3. **Understanding a specific gap** — A developer sees that their harness lacks a capability, expands the detail, and reads *why* (e.g., the harness cannot intercept file writes) rather than just seeing a blank cell.
4. **Comparing two candidates** — A developer weighing two harnesses reads the matrix side by side to see which trade-offs matter for their workflow.

## Scope

### In Scope

- A dedicated, linkable page presenting the harness capability comparison
- A primary comparison matrix expressed in **product-level capabilities** (what the user gets), with harnesses as one axis and capabilities as the other
- Clear per-cell support states that distinguish full support, partial/advisory support, and no support
- Expandable or otherwise progressively-disclosed **technical detail** explaining the underlying platform mechanism behind each harness's support level
- A short framing introduction explaining that harnesses differ and how to read the matrix
- Caveat/footnote content noting that platform capabilities change over time and were verified as of a point in time
- A navigation entry linking to this page from the site's primary navigation
- A link from the existing home-page platform section to this page

### Out of Scope

- Editing or replacing the home-page platform section itself (it remains a logo/summary row that links here)
- Per-harness setup or installation instructions (belongs with getting-started / docs)
- Interactive filtering, sorting, or search within the matrix
- User-submitted or crowd-sourced capability data
- Automated verification of harness capabilities against live tools

### Deferred

- A "recommended harness" callout or scoring/ranking of harnesses
- Version-stamped history of how capability support has changed over time
- Deep-linking to an individual harness's column or capability row

## Capabilities

### Comparison Matrix

- [x] **P0**: Page presents a comparison matrix of supported harnesses against gspec capabilities
  - All currently supported harnesses appear as columns (or rows) with a clear, identifiable label
  - Product-level capabilities are the primary axis: at minimum spec authoring, autonomous build, hard enforcement on the interactive path, hard enforcement on the build path, and the learning loop / memory
  - Every intersection shows an unambiguous support state, not a blank
  - The matrix is legible at a glance without reading prose

- [x] **P0**: Each cell communicates a distinct support state
  - At least three states are visually distinguishable: full support, partial or advisory-only support, and not supported
  - States are conveyed by more than color alone (e.g., an icon, glyph, or label) so they are accessible to color-blind users and screen readers
  - A legend explains what each state means

### Progressive Technical Detail

- [x] **P1**: Users can reveal the technical reason behind a harness's support level
  - Underlying platform facts are available on demand (e.g., file-write hook availability, tool-interception model, native per-agent memory, headless engine support) without cluttering the primary matrix
  - Detail is hidden by default and revealed through an explicit interaction (expand/disclose)
  - The relationship between a product-level capability and its technical basis is clear to the reader

### Framing & Caveats

- [x] **P1**: Page frames how to interpret the comparison
  - A short introduction explains that harnesses are not equivalent and what the reader should take away
  - The distinction between the interactive path and the autonomous build path is explained in plain terms
  - A caveat notes that harness platforms change frequently and states the point in time the data was verified

### Discovery & Navigation

- [x] **P0**: The page is reachable from site navigation
  - Primary navigation includes a link to this page
  - The existing home-page platform section links through to this page
  - Navigation reflects the current active page state consistent with other pages

### Responsive Layout

- [x] **P1**: The comparison renders correctly across screen sizes
  - The matrix remains readable on desktop, tablet, and mobile without horizontal overflow that hides data
  - On narrow viewports the matrix adapts (e.g., horizontal scroll within its own container, or a stacked per-harness layout) rather than breaking the page
  - Support states and the legend remain legible at all sizes

## Dependencies

- **Home Page** (`home-page.md`) — The existing platform section links to this page; this feature adds the destination and the navigation entry. No change to the home-page section's own content is required.
- **External data source** — Capability content is sourced from the project's maintained harness-parity reference. This is a content dependency, not a runtime one; the page renders from static, curated data.

## Assumptions & Risks

### Assumptions

- The set of supported harnesses and their capability states are curated and maintained by the project, not fetched live.
- A three-state model (full / partial / none) is sufficient to express the meaningful differences between harnesses.
- Product-level capabilities are more useful to most visitors as the default view than the raw technical matrix.

### Risks

- **Capability data drifts from reality** — Harness platforms change monthly, so the matrix can become stale. *Mitigation:* Source from a single maintained reference, display a "verified as of" date, and keep the data in one easily-updated location.
- **Overwhelming the reader** — A dense matrix with technical jargon can lose non-expert visitors. *Mitigation:* Lead with product-level capabilities and plain-language states; keep technical mechanism behind progressive disclosure.
- **Perceived bias** — Showing one harness as strongest may read as favoritism. *Mitigation:* Present verifiable capability facts and their technical basis rather than subjective rankings; defer any explicit recommendation.

## Success Metrics

1. **Comparison engagement** — Visitors who reach the page and interact with it (expand technical detail or scroll through the full matrix), indicating the comparison is being used to make decisions.
2. **Navigation click-through** — Visitors who reach the page from the home-page platform section or primary navigation.
3. **Content accuracy** — The matrix matches the maintained parity reference at any given time (measured by review, not analytics).

## Implementation Context

> This feature PRD is portable and project-agnostic. During implementation, consult the project's `gspec/profile.md` (target users, positioning), `gspec/style.md` (design system), `gspec/stack.md` (technology choices), and `gspec/practices.md` (development standards) to resolve project-specific context.
