# Engineer / Claude Code handoff prompt

Copy this prompt into your coding agent while the extracted repository is the working directory:

> You are finishing a minimal Paseo plugin named Workbench. Read `README.md`, `docs/ENGINEERING_SPEC.md`, `docs/ENGINEER_HANDOFF.md`, and `docs/IMPLEMENTATION_BACKLOG.md` before editing. The architecture is intentionally a Paseo plugin, not a fork, mission system, or alternative chat client. **Do not rewrite it from scratch.**
>
> Start by installing dependencies and typechecking against the installed Paseo SDK, resolving API drift. Run `npm run test:unit`, and add integration tests using a disposable test repo and a local development Paseo daemon. Fix failures before adding new features. Validate on the installed v0.12 release, not just source `main` docs. Do not modify the user's production repos or launch expensive autonomous agents for testing.
>
> The first release needs: projects/agents overview across connected hosts, explicit Coordinator creation and notes snapshot refresh, host-persisted project notes, manually launched customizable Reviewer and other specialists, and managed-agent hierarchy plus honestly labeled live-only provider-native children. Keep all model work opt-in and preserve normal Paseo agent views.
>
> Pay special attention to Reviewer permission boundaries: prompts saying “do not edit” are **not** a sandbox. Discover model/mode capabilities from Paseo and verify chosen read-only mode or provide a clearly labeled limitation and a safe fallback. Make Coordinator creation idempotent, support disconnected hosts without stale “all clear” indications, and respect optimistic settings revisions.
>
> Do not implement native-subagent SDK extension in the first milestone. Document its proposed API and only implement after agreement. If a public API is missing, isolate the gap and preserve a working plugin-only build. Test desktop and phone clients. Mark each backlog item done only with evidence and commands/results.
>
> Deliver the corrected plugin source, a concise test report, installation instructions, explicit remaining known issues, and a suggested next iteration. Work in the branch/repo supplied for Workbench only.
