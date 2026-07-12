Shared formatting conventions for every gspec spec document. Writers preload this to produce correctly-shaped specs; validators preload it to check shape.

## Frontmatter
Every Markdown gspec spec begins with YAML frontmatter carrying the spec version, as the very first content in the file (before the main heading):

```
---
spec-version: <<<SPEC_VERSION>>>
---
```

Preserve this frontmatter on every edit. (The HTML style guide, `style.html`, instead carries a first-line `<!-- spec-version: … -->` comment.)

## "Not Applicable"
When a section doesn't apply to the project, mark it **Not Applicable** with a one-line reason rather than omitting it silently or fabricating content to fill it. Completeness means every expected section is *accounted for* — not that every section has invented content.

## Capabilities & acceptance criteria (feature specs)
Capabilities are Markdown checkboxes with a priority and 2–4 observable acceptance criteria:

```
- [ ] **P0**: User can sign in with email and password
  - Valid credentials → redirected to dashboard, session created
  - Invalid credentials → error shown, no session
  - Empty fields → inline validation blocks submission
```

Leave boxes unchecked (`- [ ]`) until the capability is built and every criterion is met.
