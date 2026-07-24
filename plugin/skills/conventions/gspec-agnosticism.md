How gspec keeps specs reusable and correctly scoped. Preloaded by the writers and validators of every spec except the profile.

## Profile-agnosticism (all specs except profile.md)
Every spec other than `gspec/profile.md` must be free of product, company, or business identity. Do **not** put the project name, company name, business purpose, or product-specific context in a spec's title, headings, or body. Use generic terms — "the application", "the system", "users". Product identity lives *exclusively* in `profile.md`.

Identity leaks through more than prose — sweep every one of these sites:
- **Document metadata** — an HTML guide's `<title>` element, meta tags, and source comments;
- **Chrome copy** — footer bylines, header wordmarks, and sample text rendered inside example components;
- **Identifiers** — token, class, CSS custom-property, and constant names must be generic (`--color-accent`, `type-display-16`). A product-derived prefix (`acme-micro-8` for a product named Acme) is an agnosticism breach even when every heading and paragraph is clean.

Why: it makes specs portable (a stack or style can be reused across projects) and keeps each spec's concern clean.

This applies to stack, practices, style, architecture, research, and feature specs. It does **not** apply to `profile.md`, whose entire job is product identity.

## Technology-agnosticism (feature specs / PRDs only)
Feature PRDs describe *what* the product does, not *how* it's built — so they avoid specific technology names. Say "a data store", "an authentication mechanism", "a background job", not "PostgreSQL", "Auth0", "a Redis queue". Technology choices live in `stack.md`; structure lives in `architecture.md`.

Note the one place agnosticism and the architect diverge: **stack.md and architecture.md are deliberately technology-aware.** Tech-agnostic vocabulary is a rule for PRDs, not for the architect's specs.
