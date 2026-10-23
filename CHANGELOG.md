# Changelog

## 0.1.0-alpha.20 — 2026-10-23
- Command: the coordinator chooser sits above "Its agents" (below the chat on a phone), within reach of the message box.
- Question forms show each option's full description (and preview), not just its label.
- Removed the suggested messages ("Where do things stand?", "What needs me?", "Check PRs").

## 0.1.0-alpha.19 — 2026-10-22
- Sidebar badge beside Workbench: agents that need you (amber) and agents working (▶).

## 0.1.0-alpha.18 — 2026-10-22
- Session summarizer from Launch: "An agent's conversation" lists the workspace's agents to pick from (the default for the summarizer); the conversation is read from Paseo into its prompt.

## 0.1.0-alpha.17 — 2026-10-22
- Archive buttons only in Overview (not in Command's Needs attention or a coordinator's tree).
- **Worktrees** list in Overview: every Paseo worktree on the host with agents, activity and uncommitted changes; Remove (Paseo's archive) asks before discarding changes.
- PR reviews reuse the worktree already open for that pull request; the PR manager is told to do the same for fixers.
- Archiving the last agent of a Workbench PR-review worktree removes the worktree if nothing uncommitted would be lost.
- Integration tests archive the worktrees they create.

## 0.1.0-alpha.16 — 2026-10-22
- Schedules list each run (time, status, result, Open). Paseo already archives a run's agent when it ends.
- **Archive** finished or failed agents from Needs attention, Overview and a coordinator's tree; **Archive finished specialists** in Overview clears all finished Workbench specialists (with their review teams) after a confirm.

## 0.1.0-alpha.15 — 2026-10-22
- All coordinators share one working folder, so Paseo lists them in one project (**coordinators**); each keeps its own context file. Coordinators started earlier keep working where they are.
- **Rename** a coordinator from its card (or Edit): renames it in Workbench and its agent in Paseo's sidebar.

## 0.1.0-alpha.14 — 2026-10-22
- "General coordinator" is now just **Coordinator** (settings v9 renames it if you had not renamed it yourself), and it can run **In a workspace**: a coordinator for that one workspace.
- Settings: a separate **+ New specialist** button opens its own panel (name, Create, Cancel).

## 0.1.0-alpha.13 — 2026-10-22
- Removed pre-release settings upgrades and the old built-in texts they compared against; documents from before alpha.9 load as stored.
- Neutral examples in Settings and docs.
- Coordinator and PR manager instructions say how to load Paseo's tools when Claude Code defers them.
- Coordination picker shows a project's workspaces only while it is selected.

## 0.1.0-alpha.12 — 2026-10-22
- **Generic built-in instructions**: no personal skill names or domain-specific terms in the defaults (installed hosts keep what they stored).
- **Skills to use** per specialist: skill names the agent is told to load first.
- **Your specialists folder**: Markdown files on the host (one per specialist), read live; a file named like a built-in replaces it.
- **Import specialists** from another host's Export or a JSON list.

## 0.1.0-alpha.11 — 2026-10-22
- Tabs: **Command** (first; Needs attention now on top of it), **Launch**, **Overview** (was Activity: the agent tree), **Settings**.

## 0.1.0-alpha.10 — 2026-10-22
- Coordination picker (Command's **Select coordination projects** and the Launch form): tapping a project selects it and opens its workspaces; tapping workspaces narrows it to those (✓ whole project, ◐ some workspaces).

## 0.1.0-alpha.9 — 2026-10-22
- **PR manager runs in a workspace too**: a one-time (or scheduled) check of that repository's pull requests; across projects it is still a coordinator (settings v8).
- Launcher: "What should it look at?" with plain choices (Uncommitted changes, This branch, A pull request, Something else, This agent's session) and a line explaining the selected one; non-reviewers start on "Something else".
- Settings: "Undo changes" instead of "Discard"; a separate "Create a new specialist" block that says it starts blank; stale texts fixed.

## 0.1.0-alpha.8 — 2026-10-22
- **One launch form**: What → **Where it runs** (In a workspace / Across projects) → **When** (One time / Scheduled) → details → one button. The separate "Launch a specialist" section is gone from the Launch tab.
- **Schedules** through Paseo's scheduler: a workspace schedule starts a new agent at each run; a scheduled coordinator gets recurring check-ins. A Schedules list to pause, resume or delete them.
- **Take over existing agents** when launching a coordinator (they become its subagents); **Release** in Command.
- Fewer specialists: **General coordinator** (first), Reviewer, **Experiment reviewer** (merges Results reviewer and Experiment summarizer), Debugger, Session summarizer, PR manager. Researcher and Architect are removed unless you edited them (settings v7 migration).
- Command shows only coordinators that still exist; entries of archived ones are pruned at the next launch.
- Naming: Workbench (repo renamed to `paseo-workbench`), Specialists (no more "helpers" in the UI or code; stored keys unchanged), Coordinator.

## 0.1.0-alpha.7 — 2026-10-22
- Four tabs: **Launch** (Overview + Helpers merged), **Command**, **Activity**, **Settings**; header is just "Workbench" and the counts.
- Coordinators are a way to run any profile: **Once** or **As coordinator**; Coordinator and PR manager are coordinator-only profiles (settings v6 migration).
- Command lists every coordinator with its controls (projects, watched PRs, refresh, snapshot, edit, start).
- Activity: Needs attention above the agent tree; whole rows open the agent (no Open buttons).

## 0.1.0-alpha.6 — 2026-10-22
- **PR manager**: Coordinator preset that checks watched pull requests on request (yours / asking for your review / all), reports status and fixes, and starts fixers in PR worktrees (ask-before-shell modes). Its single read-only `gh`/`git` commands are auto-approved; it is denied `gh pr merge` and `git push`.
- Found and documented: the user's Claude Code always-allow rules apply to Workbench's Claude agents even in plan mode; the plan-mode label now says so.

## 0.1.0-alpha.5 — 2026-10-22
- **Command** tab: chat with a running Coordinator (live transcript, inline answers to its questions, steering composer, quick prompts, context meter) beside the live tree of everything it started.
- Activity uses the same tree, with **Summarize** on any agent.
- **Session summarizer** (reads an agent's conversation from Paseo, summarizes read-only in its workspace) and **Experiment summarizer** profiles.
- Relay hardening: exactly-once relay ids, steer-only sends, sweep on any event, reply detection by position; a team that cannot form is refused rather than degraded.

## 0.1.0-alpha.4 — 2026-10-22
- Removed the Projects pane and project notes (the stored field is kept so earlier notes are not erased; see Export).
- **Committee review** (Reviewer default): independent reviews, server-relayed exchange, consensus with divergences. Review modes Single / Second opinion / Committee per profile.
- Coordinators: **+ New coordinator**, project-based **Select coordination projects** with a "Coordinates:" indicator.
- Specialist profiles can be deleted.
- Needs attention: agents started by another agent no longer show "finished"; their permissions and failures are labeled with the parent.
- Helpers: **Show prompt** previews exactly what Launch sends.

## 0.1.0-alpha.3 — 2026-10-21
- Reviewer can follow a review skill when present (built-in fallback); new **Results reviewer** profile.
- **Pull request** review scope in a new worktree workspace at `refs/pull/N/head`.
- **Second opinion** on any catalog model, opt-in per launch; findings relayed once by the daemon to the main reviewer, which verifies them.
- Codex read-only via its requested OS sandbox (tested against a writable control), labeled "requested, not verifiable per launch".
- **Multiple Coordinators**, each over chosen workspaces or the whole host, with its own home and snapshot; fully autonomous orchestration through Paseo's agent tools, auto-approved by the plugin only for a narrow tool set and never for permission escalation.
- Settings v2/v3 migrations keep user edits, notes and the existing Coordinator link.

## 0.1.0-alpha.2 — 2026-10-21
- Validated against installed Paseo 0.12.0 on a disposable daemon; integration suite added (`npm run test:integration`).
- Fixed SDK drift: dependency versions, `workspaceDirectory`, agent panel typing.
- Reviewer and read-only profiles: launch only in a provider-enforced mode (Claude `plan`), verified via Paseo before the task is sent; Codex refused (unverifiable on 0.12).
- Model and mode pickers from the host's provider catalog; no model guessing.
- Coordinator creation idempotent across devices and restarts; archived Coordinator replaced via a compare-and-set generation.
- Offline/failed hosts reported explicitly, with no false "all clear"; live-only native subagent notice and feed errors.
- Drafts survive other devices' saves; stale saves refused.
- Reviews launched from a closed parent agent now work (direct parent label).
- Snapshot preview, notes/profile export, phone layout fix, host label disambiguation.
- Native-subagent SDK extension documented as a proposal only.

## 0.1.0-alpha.1 — 2026-10-21
- Initial independent Paseo Workbench plugin architecture and source.
- Global Workbench screen with projects, attention, notes, Coordinator, specialist actions, hierarchy.
- Host-saved instructions/profiles, coordinator context file, cross-host metadata reads.
- Provider-native subagent event observation (live-only, incomplete after reconnect).
- Context-sensitive workspace and agent specialist panels.
- SDK-independent unit tests, detailed product spec and engineer handoff.
- **Not** tested against a live Paseo daemon or installed npm SDK (unavailable in the authoring environment).
