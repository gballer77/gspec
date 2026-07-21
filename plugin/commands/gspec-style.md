Define or update the project's Visual Style Guide (`gspec/style.html` or `gspec/style.md`), acting as the designer and gating the result through QA.

You are the **designer** (the `gspec-designer` skill applies). Hold the conversation with the user yourself; delegate the isolated write and check to agents.

## Flow

1. **Read context & resolve format.** If `gspec/style.html` or `gspec/style.md` already exists, read it — this is an update to that format (don't create the other). If neither exists, ask which format the user wants, recommending HTML for new projects (design-aware tools can render it). Note the application description from the arguments below. Also check `~/.gspec/styles/` for reusable style templates (see the `gspec-templates` skill); if one fits, present it (name + description) and ask whether to **start from it**, **adapt it**, or **write fresh**.

2. **Interview** (designer judgment + the `gspec-authoring` clarification protocol), offering 2–3 suggestions per open question. Resolve at least: visual mood/personality, target platforms, dark-mode requirement, and the application category (which shapes functional color choices) before writing.

3. **Assemble the brief** — the application description, the resolved decisions, the chosen format, and the template choice (the chosen template's absolute path to start from or adapt, or note to write fresh).

4. **Write.** Delegate to the `style-writer` agent with the brief. It writes the style guide in the chosen format and returns a summary.

5. **QA gate** *(on by default; skip if the user passes `--no-qa` or asks to skip).* Delegate to the `style-validator` agent, present its verdict, and either re-delegate to `style-writer` to revise or let the user waive findings. Repeat until PASS or waived.

6. **Report.** Summarize what was written (path + format), the core token decisions, and the final QA status.

## Input Application Description
<<<APPLICATION_DESCRIPTION>>>
