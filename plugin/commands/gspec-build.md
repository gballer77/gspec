Run the autonomous "idea → built" gspec build: hold the one-time intake interview here, then hand off to the headless `gspec build` runtime, which drives every stage (profile → stack → practices → style → features → architecture → plans → implement → reconcile) unattended, self-healing each writer/validator and build/test gate.

You are the **front door** to the build. The build itself is a deterministic runtime (`lib/build.js`) that spawns its own isolated headless agent runs per stage, on the engine the user selects (`--engine claude|codex|pi`, default `claude`); the filesystem (the `gspec/` docs) is the shared state, and a run manifest (`.gspec/build/run.json`) makes it resumable. Your job is the **one interactive step it can't do headlessly** — the intake — and then to launch and monitor it.

> **When to use this vs. the individual commands.** This is the full autonomous build for a fresh idea. If the user wants to work one spec at a time with a conversation at each step, point them at `/gspec-profile`, `/gspec-stack`, `/gspec-implement`, etc. — those keep the human in the loop; this does not, after intake.

> **Engine prerequisite.** The chosen engine's CLI must be installed and authed, and gspec must be installed for that engine (`gspec install`, so its agents exist under `.claude/agents/`, `.codex/agents/`, or `.pi/agents/`). Claude uses native `--agent`; Codex and Pi run each stage by injecting the installed agent's instructions. On Pi, if a stage stalls waiting on tool approval, pass `--pi-permission-level` (sets `PI_PERMISSION_LEVEL`).

## Flow

1. **Confirm the idea and preflight.** Take the idea from the arguments below (if absent, ask for it in one line). Then:
   - Check the CLI is available: `gspec --version` (it lives in this repo's `bin/gspec.js`; if the user runs from elsewhere, `node <repo>/bin/gspec.js` also works). If it isn't installed, tell the user and stop.
   - Check for an existing run: if `.gspec/build/run.json` exists, **do not start over** — report where it paused (read the manifest's stage statuses) and offer to **resume** it (step 4 with `--resume`) or to remove the file and restart. Stop for the user's choice.

2. **Intake interview** (the build's one interactive step — done here so it isn't lost to headless mode). Interview the user **once** to resolve the decisions the whole autonomous build pivots on. Offer 2–3 concrete suggestions per question. Cover at least:
   - **Product type & primary audience** (web app / API / CLI / mobile / library …).
   - **Technology lean** (any framework/language/hosting preferences or hard constraints; otherwise note "architect's choice").
   - **Visual style direction** (a look/feel, an existing brand, or **"no UI"**).
   - **Scope boundaries** — what's in for this build and what's explicitly out.
   Do not proceed while a load-bearing choice is unresolved.

3. **Write the brief.** Assemble a concise brief — the idea plus every decision you just resolved and any clearly-labeled assumptions — and write it to `.gspec/build/brief.md`. This is the exact file the runtime looks for; because it now exists, the build **skips its own intake** and runs fully unattended. Show the user the brief and get a final go-ahead before launching.

4. **Launch the build.** Run the CLI as a **background** task (it is long — nine stages, each spawning agent runs — and it survives across turns):
   - Fresh run: `gspec build "<idea>" [--engine claude|codex|pi]`
   - Resume: `gspec build --resume` (the run stays on the engine it started on, recorded in the manifest — a conflicting `--engine` is ignored)
   - Honor flags from the arguments: pass through `--engine`, `--no-qa` to skip the validator gates, `--pi-permission-level <level>` for Pi, and offer `--dry-run` first if the user just wants to preview the stage plan (it prints every engine command it *would* run and spawns nothing).
   Note that each stage runs as its own headless process on the chosen engine (`claude` / `codex` / `pi`), under the user's session/auth.

5. **Monitor and report.** Stream/checkpoint progress from the background task and the manifest (`.gspec/build/run.json`) — which stage is running, gate verdicts, and skips. If the build **pauses on a failure**, surface the failing stage and its reason, and tell the user they can fix the issue and re-run this command to **resume** from exactly there. On success, report that specs + code are in place and point at the run record. Either way, the runtime finishes by printing a **"Learnings recorded this run"** report — the lessons agents captured to memory during the build (promotable via `/gspec-distill`) and the QA feedback events that drove a self-heal; relay it, and surface any captured lessons to the user.

## Input Idea (and any flags: --engine, --no-qa, --dry-run, --resume, --pi-permission-level)
<<<BUILD_IDEA>>>
