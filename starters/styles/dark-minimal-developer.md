---
gspec-version: 1.8.0
description: Dark-first minimal design system with purple accent, inspired by developer documentation sites
---

# Visual Style Guide

## 1. Overview

### Design Vision Statement

A clean, minimal design system that feels like well-written documentation — spacious, readable, and quietly confident. The aesthetic communicates technical credibility without being cold, using generous whitespace, clear typographic hierarchy, and a single vibrant accent color against a neutral dark canvas.

### Target Platforms

- **Web** — Primary. Responsive web application.
- **Mobile web** — Fully responsive. No native mobile app.

### Visual Personality

**Clean & Minimal** — Generous whitespace, restrained color usage, strong typography. The design gets out of the way and lets content speak. Inspired by the best developer documentation sites (Stripe, Tailwind, Astro docs) where clarity is the primary design value.

### Design Rationale

Developer tools earn trust through clarity, not decoration. The target audience values scannability, readability, and speed. A minimal aesthetic with a single vibrant accent creates visual interest without visual noise. Dark-first design matches the environment developers already work in (editors, terminals).

---

## 2. Color Palette

### Primary Colors

| Token | Hex | RGB | HSL | Usage |
|-------|-----|-----|-----|-------|
| `primary-500` | `#8B5CF6` | `139, 92, 246` | `263, 90%, 66%` | Primary accent — CTAs, links, active states, key UI elements |
| `primary-400` | `#A78BFA` | `167, 139, 250` | `255, 92%, 76%` | Hover states, secondary emphasis |
| `primary-600` | `#7C3AED` | `124, 58, 237` | `262, 83%, 58%` | Pressed/active states |
| `primary-300` | `#C4B5FD` | `196, 181, 253` | `252, 95%, 85%` | Light accent text on dark backgrounds |
| `primary-900` | `#1E1338` | `30, 19, 56` | `258, 49%, 15%` | Tinted dark backgrounds, subtle accent surfaces |

**Selection rationale:** Purple sits outside the typical blue/green palette of most dev tools, giving the brand a distinctive presence. It carries connotations of creativity and precision without the corporate weight of blue. The violet hue has excellent contrast against both dark and light neutrals.

### Secondary Colors

| Token | Hex | RGB | HSL | Usage |
|-------|-----|-----|-----|-------|
| `secondary-500` | `#06B6D4` | `6, 182, 212` | `189, 94%, 43%` | Code highlights, secondary actions, complementary accent |
| `secondary-400` | `#22D3EE` | `34, 211, 238` | `188, 85%, 53%` | Hover states for secondary elements |
| `secondary-600` | `#0891B2` | `8, 145, 178` | `192, 91%, 36%` | Pressed states for secondary elements |

**Usage:** The cyan secondary complements the purple primary (split-complementary relationship). Use sparingly for code syntax highlighting, badges, or secondary interactive elements. Never compete with the primary accent for attention.

### Neutral Colors

| Token | Hex | RGB | HSL | Usage |
|-------|-----|-----|-----|-------|
| `neutral-950` | `#0A0A0F` | `10, 10, 15` | `240, 20%, 5%` | Page background (dark mode) |
| `neutral-900` | `#131318` | `19, 19, 24` | `240, 12%, 8%` | Elevated surface background |
| `neutral-800` | `#1E1E26` | `30, 30, 38` | `240, 12%, 13%` | Card backgrounds, code blocks |
| `neutral-700` | `#2E2E3A` | `46, 46, 58` | `240, 12%, 20%` | Borders, dividers |
| `neutral-600` | `#4A4A5A` | `74, 74, 90` | `240, 10%, 32%` | Subtle borders, disabled elements |
| `neutral-500` | `#6B6B80` | `107, 107, 128` | `240, 9%, 46%` | Placeholder text, muted icons |
| `neutral-400` | `#9494A8` | `148, 148, 168` | `240, 10%, 62%` | Secondary text |
| `neutral-300` | `#B8B8CC` | `184, 184, 204` | `240, 18%, 76%` | Tertiary text, captions |
| `neutral-200` | `#D4D4E0` | `212, 212, 224` | `240, 20%, 85%` | Body text (dark mode) |
| `neutral-100` | `#EDEDF4` | `237, 237, 244` | `240, 33%, 94%` | Headings, primary text (dark mode) |
| `neutral-50` | `#F8F8FC` | `248, 248, 252` | `240, 50%, 98%` | Emphasis text, high contrast |

**Note:** Neutrals carry a subtle cool-violet undertone (240° hue) to harmonize with the purple primary. Pure grays would feel disconnected.

### Semantic Colors

| Token | Hex | Contrast on `neutral-900` | Usage |
|-------|-----|---------------------------|-------|
| `success` | `#34D399` | 8.2:1 ✓ AA | Success states, confirmations, valid inputs |
| `warning` | `#FBBF24` | 10.4:1 ✓ AA | Warnings, caution states |
| `error` | `#F87171` | 5.8:1 ✓ AA | Errors, destructive actions, invalid inputs |
| `info` | `#60A5FA` | 5.5:1 ✓ AA | Informational messages, tips, notes |

Each semantic color has a muted background variant at 10% opacity for banner/alert backgrounds (e.g., `success-bg: #34D3991A`).

---

## 3. Typography

### Font Families

| Role | Font | Fallback Stack | Source |
|------|------|---------------|--------|
| **Headings** | Inter | `system-ui, -apple-system, sans-serif` | Google Fonts |
| **Body** | Inter | `system-ui, -apple-system, sans-serif` | Google Fonts |
| **Monospace** | JetBrains Mono | `ui-monospace, 'Cascadia Code', 'Fira Code', monospace` | Google Fonts |

**Why Inter:** Designed for screens, excellent readability at all sizes, wide weight range, slightly technical feel without being cold. Free and widely available.

**Why JetBrains Mono:** Purpose-built for code, excellent ligature support, pairs well with Inter. Developers recognize and trust it.

### Type Scale

Base size: `16px` (1rem). Scale ratio: 1.25 (Major Third).

| Level | Size (rem) | Size (px) | Weight | Line Height | Letter Spacing | Usage |
|-------|-----------|-----------|--------|-------------|----------------|-------|
| **Display** | 3.5rem | 56px | 700 | 1.1 | -0.02em | Hero headlines |
| **H1** | 2.441rem | 39px | 700 | 1.2 | -0.02em | Page titles |
| **H2** | 1.953rem | 31px | 600 | 1.25 | -0.01em | Section headings |
| **H3** | 1.563rem | 25px | 600 | 1.3 | -0.01em | Subsection headings |
| **H4** | 1.25rem | 20px | 600 | 1.4 | 0 | Card titles, minor headings |
| **H5** | 1rem | 16px | 600 | 1.5 | 0.01em | Labels, overlines |
| **H6** | 0.875rem | 14px | 600 | 1.5 | 0.02em | Small labels, uppercase overlines |
| **Body Large** | 1.125rem | 18px | 400 | 1.7 | 0 | Lead paragraphs, feature descriptions |
| **Body** | 1rem | 16px | 400 | 1.7 | 0 | Default body text |
| **Body Small** | 0.875rem | 14px | 400 | 1.6 | 0 | Captions, helper text, metadata |
| **Code** | 0.875rem | 14px | 400 | 1.6 | 0 | Inline and block code |

### Responsive Scaling

- **Mobile (< 640px):** Display drops to 2.5rem, H1 to 1.953rem. Body remains 1rem.
- **Tablet (640–1024px):** Display at 3rem, H1 at 2.2rem.
- **Desktop (≥ 1024px):** Full scale as defined above.

---

## 4. Spacing & Layout

### Spacing Scale

Base unit: **4px**. All spacing values are multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| `space-0` | 0px | Reset |
| `space-1` | 4px | Tight inline spacing (icon-text gap) |
| `space-2` | 8px | Small gaps, compact padding |
| `space-3` | 12px | Default inline spacing |
| `space-4` | 16px | Default component padding |
| `space-5` | 20px | Medium spacing |
| `space-6` | 24px | Section internal spacing |
| `space-8` | 32px | Component gaps, card padding |
| `space-10` | 40px | Section gaps |
| `space-12` | 48px | Large section spacing |
| `space-16` | 64px | Page section separators |
| `space-20` | 80px | Major page sections |
| `space-24` | 96px | Hero sections, large vertical rhythm |

### Grid System

| Breakpoint | Columns | Gutter | Container Max-Width |
|------------|---------|--------|---------------------|
| Mobile (< 640px) | 4 | 16px | 100% (16px side padding) |
| Tablet (640–1024px) | 8 | 24px | 768px |
| Desktop (1024–1280px) | 12 | 24px | 1024px |
| Wide (≥ 1280px) | 12 | 32px | 1152px |

### Layout Patterns

- **Content width:** Prose content maxes out at `65ch` (~680px) for optimal readability.
- **Component spacing:** Adjacent components within a section use `space-8` (32px) gaps.
- **Section spacing:** Between major page sections use `space-16` (64px) on mobile, `space-24` (96px) on desktop.
- **Consistent padding:** All cards and containers use `space-6` (24px) padding on mobile, `space-8` (32px) on desktop.

---

## 5. Themes

### Dark Mode (Primary)

| Token | Color | Usage |
|-------|-------|-------|
| `bg-page` | `neutral-950` (#0A0A0F) | Page background |
| `bg-surface` | `neutral-900` (#131318) | Cards, elevated surfaces |
| `bg-surface-raised` | `neutral-800` (#1E1E26) | Code blocks, nested surfaces |
| `bg-overlay` | `neutral-950` at 80% opacity | Modal/drawer overlays |
| `text-primary` | `neutral-100` (#EDEDF4) | Headings, emphasis text |
| `text-body` | `neutral-200` (#D4D4E0) | Default body text |
| `text-secondary` | `neutral-400` (#9494A8) | Secondary text, captions |
| `text-muted` | `neutral-500` (#6B6B80) | Placeholders, disabled text |
| `border-default` | `neutral-700` (#2E2E3A) | Default borders |
| `border-subtle` | `neutral-800` (#1E1E26) | Subtle dividers |

### Light Mode (Secondary)

| Token | Color | Usage |
|-------|-------|-------|
| `bg-page` | `neutral-50` (#F8F8FC) | Page background |
| `bg-surface` | `#FFFFFF` | Cards, elevated surfaces |
| `bg-surface-raised` | `neutral-100` (#EDEDF4) | Code blocks, nested surfaces |
| `bg-overlay` | `neutral-950` at 50% opacity | Modal/drawer overlays |
| `text-primary` | `neutral-950` (#0A0A0F) | Headings, emphasis text |
| `text-body` | `neutral-800` (#1E1E26) | Default body text |
| `text-secondary` | `neutral-600` (#4A4A5A) | Secondary text, captions |
| `text-muted` | `neutral-500` (#6B6B80) | Placeholders, disabled text |
| `border-default` | `neutral-300` (#B8B8CC) | Default borders |
| `border-subtle` | `neutral-200` (#D4D4E0) | Subtle dividers |

### Theme Token Mapping

- All theme values are expressed as CSS custom properties so light and dark palettes share the same token names.
- Dark mode is the primary theme. Light mode is provided as an alternative.
- Primary accent (`primary-500`) works in both themes without adjustment.
- Semantic colors remain constant across themes — their background variants adjust opacity (10% on dark, 8% on light).

---

## 6. Component Styling

> **This section defines visual styling only** — colors, borders, typography, and spacing for common UI elements. Component structure, behavior, and layout patterns are defined in feature PRDs.

### Buttons

- **Primary**: Background `primary-500`, text white, border-radius 8px, font weight 500.
- **Primary Hover**: Background `primary-400`.
- **Primary Active**: Background `primary-600`.
- **Secondary**: Background transparent, border 1px `neutral-700` (dark) / `neutral-300` (light), text `neutral-100` (dark) / `neutral-800` (light).
- **Secondary Hover**: Background `neutral-800` (dark) / `neutral-100` (light), border `neutral-600`.
- **Ghost**: Background transparent, no border, text `primary-500`. Hover: `primary-900` background.
- **Disabled**: 40% opacity, `cursor: not-allowed`.
- **Focus**: 2px `primary-400` outline with 2px offset.
- **Sizes**: Small (32px height, 14px text), Default (40px height, 16px text), Large (48px height, 18px text). Minimum touch target 44x44px.

### Form Elements

- **Input Background**: `neutral-900` (dark) / `#FFFFFF` (light).
- **Input Border**: 1px solid `neutral-700` (dark) / `neutral-300` (light), border-radius 8px.
- **Input Text**: `neutral-100` (dark) / `neutral-900` (light). Placeholder: `neutral-500`.
- **Focus**: Border `primary-500`, 2px ring in `primary-500` at 25% opacity.
- **Error**: Border `error` (#F87171), helper text in `error`.
- **Disabled**: 50% opacity, `neutral-800` background.
- **Labels**: Body Small (0.875rem), weight 500, `neutral-200` (dark) / `neutral-700` (light).
- **Helper Text**: Body Small (0.875rem), weight 400, `neutral-400` default.
- **Checkboxes/Radios**: 18px, 2px border `neutral-600`. Checked: `primary-500` fill, white mark. Radius: 4px (checkbox), 50% (radio).

### Cards & Containers

- **Background**: `bg-surface` (`neutral-900` dark / `#FFFFFF` light).
- **Border**: 1px solid `border-default`.
- **Border-radius**: 12px.
- **Padding**: `space-6` (24px) mobile, `space-8` (32px) desktop.
- **Shadow**: None by default in dark mode (relies on border contrast). Light mode uses elevation 1.
- **Hover (interactive)**: Border shifts to `neutral-600` (dark) / `neutral-400` (light).

### Navigation Elements

- **Link Color**: `neutral-300` default, `neutral-100` on hover, `primary-400` when active.
- **Link Weight**: 400 default, 500 when active.
- **Nav Background**: `neutral-950` at 80% opacity with `backdrop-filter: blur(12px)`.
- **Nav Border**: 1px solid `neutral-800` bottom edge.

---

## 7. Visual Effects

### Shadows & Elevation

All shadows use a violet-tinted black for cohesion with the palette.

| Level | CSS Value | Usage |
|-------|-----------|-------|
| **Elevation 0** | none | Default flat elements |
| **Elevation 1** | `0 1px 3px rgba(10, 10, 15, 0.3), 0 1px 2px rgba(10, 10, 15, 0.2)` | Cards (light mode), subtle lift |
| **Elevation 2** | `0 4px 6px rgba(10, 10, 15, 0.3), 0 2px 4px rgba(10, 10, 15, 0.2)` | Hover states, popovers |
| **Elevation 3** | `0 10px 15px rgba(10, 10, 15, 0.35), 0 4px 6px rgba(10, 10, 15, 0.2)` | Dropdowns, tooltips |
| **Elevation 4** | `0 20px 25px rgba(10, 10, 15, 0.4), 0 8px 10px rgba(10, 10, 15, 0.2)` | Modals, dialogs |

**Dark mode note:** Shadows are less visible on dark backgrounds. Dark mode relies primarily on border contrast and surface color differentiation for depth. Shadows are most impactful in light mode.

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 4px | Small elements (badges, tags, checkboxes) |
| `radius-md` | 8px | Buttons, inputs, small cards |
| `radius-lg` | 12px | Cards, containers, modals |
| `radius-xl` | 16px | Large feature cards, hero elements |
| `radius-full` | 9999px | Pills, avatars, circular buttons |

### Transitions & Animations

#### Duration Standards
| Token | Value | Usage |
|-------|-------|-------|
| `duration-fast` | 100ms | Color changes, opacity |
| `duration-normal` | 200ms | Most interactions (hover, focus, toggle) |
| `duration-slow` | 300ms | Layout changes, expand/collapse |
| `duration-slower` | 500ms | Page transitions, large reveals |

#### Easing Functions
| Token | Value | Usage |
|-------|-------|-------|
| `ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | General purpose |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elements exiting view |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering view |
| `ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Playful micro-interactions (sparingly) |

#### Animation Principles
- Prefer opacity and transform animations (GPU-accelerated).
- No animation on page load for above-the-fold content — content should appear instantly.
- Subtle scroll-triggered fade-ins for below-the-fold sections: `opacity: 0 → 1`, `translateY(8px) → 0`, `duration-slow`.
- Loading states: Use skeleton screens with a subtle pulse animation (`opacity: 0.5 → 1`, 1.5s, infinite).

---

## 8. Iconography

### Icon Library
- **Library:** [Lucide Icons](https://lucide.dev/) — MIT-licensed, consistent stroke-based set, excellent coverage for developer tool UIs
- **Style:** Outlined (stroke-based)
- **Stroke width:** 1.5px
- **Default size:** 20px (pairs with body text), 24px (navigation/buttons), 16px (small/inline)

### Usage Guidelines
- Icons should be accompanied by text labels in navigation — icon-only buttons require tooltips.
- **Icon-text spacing:** `space-2` (8px)
- **Icon color:** Inherits text color by default. Interactive icons use `neutral-400` default, `neutral-100` on hover.
- Keep icon usage restrained — not every list item or label needs an icon.

---

## 9. Imagery & Media

### Photography Style

Not Applicable — developer tooling site relies on code examples, diagrams, and UI illustrations rather than photography.

### Illustrations

- **Style:** Minimal, geometric line illustrations using the primary and secondary palette.
- **Stroke weight:** Match icon stroke (1.5px) for cohesion.
- **Color usage:** Primary purple for emphasis, neutrals for structure, cyan secondary for accents.
- **Use cases:** Hero section visuals, feature explanations, empty states.
- Keep illustrations abstract and functional — avoid characters or lifestyle imagery.

### Code Blocks
- **Background:** `neutral-800` (#1E1E26)
- **Border:** 1px solid `neutral-700`
- **Border radius:** `radius-lg` (12px)
- **Padding:** `space-6` (24px)
- **Font:** JetBrains Mono, 0.875rem
- **Line numbers:** `neutral-500`
- **Syntax highlighting:** Use primary purple, secondary cyan, semantic colors, and neutrals for a cohesive code theme.

---

## 10. Accessibility

### Contrast Requirements
- **Target:** WCAG 2.1 AA compliance
- **Normal text:** Minimum 4.5:1 contrast ratio
- **Large text (≥ 18px bold or ≥ 24px regular):** Minimum 3:1 contrast ratio
- **Interactive elements:** Minimum 3:1 against adjacent colors
- All color pairings in this guide meet AA requirements. Key validations:
  - `neutral-200` on `neutral-950`: 14.8:1 ✓
  - `neutral-400` on `neutral-950`: 5.6:1 ✓
  - `primary-500` on `neutral-950`: 5.1:1 ✓

### Focus States
- **Focus ring:** 2px solid `primary-400` (#A78BFA) with 2px offset from the element
- **Focus ring (high contrast):** Falls back to browser default outline in `forced-colors` mode
- **All interactive elements** must have visible focus indicators — never use `outline: none` without a replacement
- **Tab order:** Follows logical reading order (top-to-bottom, left-to-right)

### Text Accessibility
- **Minimum body font size:** 16px (1rem) — never go below 14px for any readable text
- **Maximum line length:** 65ch (~680px) for body text
- **Line height:** Minimum 1.5 for body text
- **Avoid justified text** — use left-aligned (or right-aligned for RTL) only
- **Link distinction:** Links use `primary-400` color AND underline-on-hover (color alone is insufficient)

---

## 11. Responsive Design

### Breakpoints

| Name | Min Width | Tailwind Prefix |
|------|-----------|-----------------|
| Mobile | 0px | (default) |
| Small | 640px | `sm:` |
| Medium | 768px | `md:` |
| Large | 1024px | `lg:` |
| XL | 1280px | `xl:` |

### Scaling Strategy
- **Mobile-first** — Default styles target mobile, breakpoints add complexity for larger screens.
- Typography scales down on mobile (see Type Scale responsive section).
- Spacing reduces by one step on mobile (e.g., `space-24` desktop → `space-16` mobile for section gaps).
- Grid collapses from 12 columns to 4 on mobile with single-column stacking.

### Mobile-Specific Patterns
- **Touch targets:** Minimum 44px × 44px for all interactive elements
- **Navigation:** Hamburger menu with fullscreen overlay. No horizontal scrolling nav.
- **Cards:** Stack vertically with full width, `space-4` (16px) gaps
- **Buttons:** Full-width on mobile for primary actions in forms/CTAs
- **Scroll behavior:** `scroll-padding-top: 80px` to account for fixed header when using anchor links

---

## 12. Usage Examples

### Component Combinations

#### Hero Section
- Full-width dark background (`neutral-950`)
- Display heading in `neutral-100`, max 15 words
- Body Large subtitle in `neutral-400`, max 2 lines
- Primary CTA button + Secondary ghost button side by side
- `space-24` (96px) vertical padding

#### Feature Card Grid
- 3-column grid on desktop, single column on mobile
- Cards with `neutral-900` background, `neutral-700` border, `radius-lg`
- Icon (Lucide, 24px, `primary-400`) top-left
- H4 title, Body Small description in `neutral-300`
- `space-8` (32px) gap between cards

#### Code Example Block
- `neutral-800` background, `radius-lg`, `neutral-700` border
- Language badge top-right: `primary-900` background, `primary-300` text, `radius-sm`, Body Small
- JetBrains Mono at 14px
- Copy button: ghost style, top-right, icon-only with tooltip
- `space-6` padding

#### Documentation Page
- Fixed sidebar navigation (left, 240px width) on desktop, hidden on mobile
- Content area centered, max `65ch`
- H2 sections separated by `space-16`
- In-page table of contents (right sidebar, 200px) on wide screens (≥ 1280px)

### Do's and Don'ts

**Do:**
- Use the primary purple for a single focal action per viewport (one primary CTA)
- Maintain generous whitespace — when in doubt, add more space
- Use monospace font for any code references, CLI commands, or technical identifiers
- Keep text under 65ch line length for readability

**Don't:**
- Use purple backgrounds for large areas — reserve it for accents and interactive elements
- Mix multiple accent colors in the same component
- Use shadows as the primary depth indicator in dark mode — use surface colors and borders
- Reduce touch targets below 44px on mobile
- Use color alone to convey meaning — pair with icons, text, or patterns
