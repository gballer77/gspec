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
When a section doesn't apply to the project, mark it **Not Applicable** with a one-line reason rather than omitting it silently or fabricating content to fill it. Completeness means every expected section is *accounted for* — not that every section has invented content. **One line and a reason is the whole section** — a section that declares itself Not Applicable and then specifies itself anyway is the most expensive kind of padding.

## The required-section list is exhaustive
Each spec type's persona names its required sections. That list is both a floor and a **ceiling**: every section is accounted for (present, or Not Applicable), and no section outside the list is added. A spec that grows its own new sections has started absorbing a neighbouring spec's job. Where a persona marks a section optional, it is optional to *include* — never a licence to invent others.

## Single source of truth (state each fact once)
The value of a spec is its set of normative decisions; its bytes are mostly restatement and illustration of them. Every restatement is a second copy that can disagree with the first — in practice large specs fail QA on internal cross-reference drift, not missing content. So:

- Every class of fact has **one canonical home** in the document (design tokens in the token block, a standard in its section, a capability in its checkbox). Everywhere else *references* the canonical statement; it never repeats the value.
- **One example per pattern.** An illustration demonstrates a rule once; further examples add drift surface, not value.
- A section whose removal loses no normative content is a **defect**, the same as a missing section. Completeness and concision are one bar seen from two sides: every fact accounted for, and each fact stated exactly once.

## Size budgets (every deliverable has a ceiling)
Length is a defect surface, not a measure of effort. A spec's real failure modes — internal contradiction, cross-reference drift, restatement — all scale with its size, and an oversized draft is also the one most likely to exhaust the agent writing it *and* every downstream agent that has to read it.

The budgets below are for a **standard**-scope product. The brief states the project's scope tier; scale by it — **small ×0.6 · standard ×1.0 · large ×1.5**. Absent a stated tier, assume standard.

| deliverable | budget (standard) |
| --- | --- |
| `profile.md` | 2,000 words |
| `stack.md` | 2,000 words |
| `practices.md` | 2,000 words (the `## Enforcement` block is excluded — a hook parses it) |
| `style.md` | 2,000 words |
| `style.html` | 1,500 words of prose (tokens, markup, and rendered specimens excluded) |
| `research.md` | 2,000 words |
| `features/<slug>.md` | 1,800 words |
| `architecture.md` | 3,000 words — single file, or the system tier plus 1,500 per `architecture/<name>.md` |
| `tasks/<slug>.md` | ≤ 25 tasks, ≤ 3 per capability, one sentence each |

How to apply them:

- **Count everything the file contains — prose *and* tables.** Tables are where an over-long spec usually hides. Only frontmatter and the practices `Enforcement` block are exempt.
- **A budget is a ceiling, not a target.** A spec that clears its bar in half the budget is better. Brevity is never a finding on its own, and the budget never licenses dropping a required section — it forces you to say each thing exactly once (see Single source of truth above), not to say less.
- **Over budget is advisory and never blocks.** A validator reports it as at most a `[minor]` finding, whatever the overage — a spec is never failed for its size alone. It is a signal to the writer and to the human reading the QA log, not a gate.
- **A blocker or major finding outranks every rule on this list.** When a finding names content that is *missing* — a required section, a capability, an acceptance criterion — add it in full, however far past the ceiling that takes the document, and never satisfy it partially to stay near a word count. An unresolved blocker fails the gate; an overage cannot. This is the tie-break whenever two rules here pull against each other.
- **Subject to that, no fix may grow an at-budget spec.** Growth is for what the findings require and nothing else: resolve every other finding by replacing text rather than appending, and pay for required additions by cutting restatement and duplication elsewhere. A revision that grows a document while resolving no blocker/major finding is itself a defect.
- **Budget pressure is a decomposition signal, not a reason to overrun.** A feature that can't be specified within its budget is more than one feature; an architecture that can't is a multi-module system that belongs on the two-tier layout. When you are *authoring*, say so in your summary instead of blowing through the ceiling. When you are *revising* against a finding, resolve the finding first (per the tie-break above) and then say it in your summary — the split is a recommendation to the human, never a reason to leave required content out.

## Capabilities & acceptance criteria (feature specs)
Capabilities are Markdown checkboxes with a priority and 2–4 observable acceptance criteria:

```
- [ ] **P0**: User can sign in with email and password
  - Valid credentials → redirected to dashboard, session created
  - Invalid credentials → error shown, no session
  - Empty fields → inline validation blocks submission
```

Leave boxes unchecked (`- [ ]`) until the capability is built and every criterion is met.
