# Workbench for Paseo

**Status: 0.1.0-alpha.19. Validated against installed Paseo 0.12.0 on a disposable daemon (see [docs/TEST_REPORT.md](docs/TEST_REPORT.md)). Not yet run inside the native mobile app.**

Workbench adds a cross-project overview, Coordinators that orchestrate agents, and independent reusable specialist agents (with an opt-in second opinion) to Paseo. It uses native Paseo agents, workspaces, agent labels, plugin settings, and the existing mobile-compatible plugin UI. It does not replace Claude Code's own delegation, create a mission engine, or change Paseo's core.

## What it does

- **Sidebar badge**: beside Workbench in Paseo's sidebar, an amber count of agents that need you and a ▶ count of agents working (this host; refreshed every 30 seconds and after agent updates).
- **Workbench sidebar screen** with four tabs: **Command** (what needs you, then coordinators and their chat; opens first), **Launch** (start anything), **Overview** (every agent by who started what; tap any row to open it), **Settings**.
- **Launch**: one form. **What**: a specialist (Coordinator, Reviewer, Experiment reviewer, Debugger, Session summarizer, PR manager, or your own). **Where it runs**: **In a workspace** (one task in a workspace you pick, then it stops) or **Across projects** (runs as a coordinator over the projects you choose, starting and managing agents with that specialist's expertise). The **Coordinator** always runs as a coordinator, in either place: for one workspace, or across projects. **When**: **One time** or **Scheduled** (see Schedules). Then its details and one launch button.
- **Schedules** (Paseo's own scheduler): a scheduled specialist **in a workspace** is a Paseo schedule that starts a new agent there at each run (hourly, weekdays, daily, weekly or a custom cron, in your time zone). Scheduled **across projects** launches the coordinator now and adds a recurring **check-in** message to it (a Paseo heartbeat). Both are listed under **Schedules** on the Launch tab, where workspace schedules can be paused, resumed or deleted and check-ins removed. Scheduled runs are single reviews; a read-only Codex specialist cannot be scheduled (the scheduler cannot request Codex's sandbox), a read-only Claude one runs in `plan` mode.
- **Scheduled runs** show under their schedule (time, status, result, **Open**). Paseo archives each run's agent when it ends, so runs never pile up in your projects.
- **Cleaning up**: specialists you launch stay in their workspace when they finish (you usually want to read the result). **Archive** them in Overview, one by one or with **Archive finished specialists** to clear all finished Workbench specialists at once (with their review teams). Archived agents stay in Paseo's history. Nothing is archived automatically, and running agents, agents waiting on you, and coordinators are never offered.
- **Worktrees** (Overview): every Git worktree Paseo created on this host, with its agents, last activity and whether it has uncommitted changes. **Remove** uses Paseo's own workspace archive (folder deleted, branch kept, its agents archived) and asks before discarding uncommitted changes. A PR review reuses the worktree already open for that pull request, and archiving the last agent of a Workbench PR-review worktree removes the worktree too, unless it has uncommitted changes.
- **Taking over existing agents**: when launching a coordinator, pick existing top-level agents in its projects; they become its subagents (Paseo's parent label, set with `paseo agent update`), nested under it in Paseo and in Command, and the coordinator is told. **Release** in Command makes one top-level again (`paseo agent detach`).
- **Command**: talk to a running Coordinator (archived ones disappear). Its conversation streams from Paseo's own timeline (markdown replies, one line per tool call, Workbench's own relay messages collapsed); its questions appear as forms you answer there; other permission requests show what they would do and open in Paseo; Enter sends (steering a running turn, as in Paseo); quick prompts ("Where do things stand?", "What needs me?") and a context-usage meter. Beside it (below it on a phone), the tree of every agent it started, with what each is waiting on from you. Paseo's own agent view keeps working.
- **Projects across connected hosts**, grouped by `(serverId, projectId)`. A host that is offline or fails to load is named in red and counted ("1 of 2 hosts read"). Workbench never shows "all clear" for hosts it could not read.
- **Coordinators** (any number): each has a name, model, instructions, and what on this host it coordinates (**Select coordination projects**: tap a project to take all of it and open its workspaces, tap workspaces to narrow it to those; shown as "Coordinates:" pills) or every project. Created only when you click. All coordinators share one working folder (`<PASEO_HOME>/plugin-data/workbench/coordinators`), so Paseo's sidebar shows them together in one project, **coordinators**; each has its own context file there (`<id>/CONTEXT.md`). **Rename** changes the name in Workbench and the agent's title in Paseo. Agents a coordinator starts or takes over stay in their own projects and workspaces, nested under it in Command and Overview with a `CONTEXT.md` snapshot you can preview: its assignment and its workspace and agent IDs. Creation is idempotent across devices and restarts. See **Coordinator autonomy** below.
- **Specialists**: Coordinator, Reviewer, Experiment reviewer, Debugger, Session summarizer, PR manager, plus your own. Each launch is a fresh Paseo agent. The model and mode come from the host's provider catalog; Workbench never guesses a model.
- **Built-in instructions are generic.** **Experiment reviewer** turns logs, result files or experiment-tracker runs into a results table, saying which numbers it re-derived, and checks leakage, readouts, baselines and confounds. Make them yours with skills and a specialists folder (below).
- **What it looks at** (in a workspace): **Uncommitted changes**, **This branch** (against the branch it came from), **A pull request** (Paseo checks `refs/pull/N/head` out into a new worktree workspace, so your checkout is never touched), **Something else** (only what you describe), or, from an agent's panel, **This agent's session**.
- **PR manager**: **in a workspace**, checks that repository's pull requests once (yours, asking for your review, or all) and reports what each needs; starting a fixer there asks you. **Across projects**, a coordinator that, when you ask (**Check PRs** in Command), lists the pull requests you chose to watch (**Select PRs to watch**: yours, asking for your review, or all open) in its projects, reports each one's checks, reviews, conflicts and recommended fix, and starts fixer agents in worktrees checked out at the PR. Fixers commit locally; pushing waits for your OK. Its own single read-only `gh`/`git` commands run without asking; it is blocked from `gh pr merge` and `git push` itself.
- **Review modes**: Single, **Second opinion** (a second reviewer on another model; the main reviewer verifies its findings), or **Committee** (both review independently, Workbench gives each the other's review to check, then the main reviewer writes the consensus with where they diverged). Each profile has a default; the Reviewer's is Committee. Set the second reviewer's model per profile (any provider in the catalog). The plugin server relays reports when the receiving agent is idle (and steers rather than interrupts if a turn just started), sends each relay message exactly once (a relay id in the target's timeline blocks repeats), and resumes after a restart at the next agent event on the host. A committee or second opinion that cannot form is refused before any task is sent.
- **Read-only boundary for specialists** (on by default): see below.
- **Workspace and agent panels**, plus Command Center entries ("Open Workbench specialists", "Review agent work independently"). A review launched from an agent is shown as its child; it does not inherit the conversation.
- **Overview**: the tree of who started what (managed agents by Paseo's parent label, provider-native subagents observed **live only**), each node with what it waits on from you, and **Summarize** on any agent.
- **Session summarizer**: from **Launch** (In a workspace → "An agent's conversation" → pick the agent), from an agent's panel ("This agent's session"), or **Summarize** in a tree, a read-only specialist reads that agent's conversation (from Paseo; nothing is written to your repository), checks its claims against the repository, and reports decisions, changes, verified vs claimed, open questions and next steps.
- **Needs attention** from Paseo's own agent state, grouped by project, most urgent first: why each agent needs you, the exact command/file/URL of a pending permission, the error, and how long ago. Agents started by another agent (committee members, a Coordinator's workers) only show permissions and failures, labeled with who started them. No LLM classification.
- **Specialists** can be added (**+ New specialist**), edited and deleted in Settings.

## Make it yours: skills, a specialists folder, import

- **Skills to use** (Settings, per specialist): names of Claude Code or Codex skills installed where the agent runs (for example `review-style`). The prompt tells the agent to load them first; one it does not have is skipped and reported.
- **Your specialists folder** (Settings): a folder on the plugin's host, for example in your own dotfiles repository, with one Markdown file per specialist. A file named like a built-in (`reviewer.md`) replaces it at launch; any other name adds one. Workbench re-reads it every 30 seconds, so editing a file (or a `git pull`) changes the next launch. Format (all header keys optional; the rest of the file is the instructions):

  ```markdown
  ---
  name: Reviewer
  description: Independent correctness review
  skills: review-style
  review: committee            # single | second-opinion | committee
  second-model: codex/gpt-6.1-sol
  read-only: true              # default true; with false, `mode:` picks the provider mode
  ---
  You are an independent code reviewer. ...
  ```

- **Import specialists** (Settings): paste another host's **Export**, or a JSON list of specialists, to copy them into this host's settings.

## Reviewer permission boundary

Prompts saying "do not edit" are not a sandbox. A profile with **Require enforced read-only** (the default for Reviewer, Experiment reviewer and Session summarizer) launches only when the provider enforces it:

| Provider | Behavior on Paseo 0.12 |
|---|---|
| Claude | Launches in `plan` mode. Workbench creates the agent without a prompt, checks Paseo reports `currentModeId: "plan"`, and only then sends the task; otherwise it archives the agent. Tested: read-only commands run, file writes and writing shell commands stop as permission requests. **Deny them to keep the review read-only**; approving one, or "Implement", allows the change. |
| Codex | Launches with its **read-only OS sandbox requested** (`sandbox_mode: read-only`, no escalation prompts). Tested: a shell write fails with "operation not permitted", while the same write with `workspace-write` succeeds. Paseo does not report the sandbox back (it shows "Default Permissions"), so Workbench labels it "requested, not verifiable per launch" and adds "read-only sandbox" to the agent title. Paseo 0.12 rejects mode `read-only` for Codex, hence the option. |
| Others | Refused for read-only profiles: no setup Workbench can enforce. |

A second opinion gets the same requirement as its profile, never a weaker one.

Turning the requirement off ("Allow edits") lets you pick any mode the provider reports. The launcher then labels the launch **NOT read-only** in red.

## Coordinator autonomy

Coordinators are fully autonomous inside their assignment: they use Paseo's agent tools to see what agents are doing, start agents, send them tasks, and cancel stuck turns, without asking you. This spends tokens unattended; the UI says so.

- **Auto-approved**, only for Coordinator agents the plugin server registered (the UI registers them on Create and Refresh context; the server checks their labels, that no agent created them, and that they run in the coordinators' folder; labels alone never count): `list_workspaces`, `list_agents`, `get_agent_status`, `get_agent_activity`, `list_pending_permissions`, `list_providers`, `list_models`, `list_profiles`, `create_agent`, `send_agent_prompt`, `cancel_agent`.
- **Still asks you**: everything else (file edits, shell, archiving or killing agents, answering any permission request, changing an agent's mode, workspaces, terminals, schedules), and any `create_agent`/`send_agent_prompt` that asks for a permission-bypassing mode (`bypassPermissions`, `full-access`) or sets Workbench labels. Tested: `archive_agent` and a `bypassPermissions` `create_agent` both stayed pending.
- Its instructions forbid committing, pushing, merging, deploying, or approving another agent's permission request without you.
- Agents it starts are its children in Paseo and in **Overview**.
- Requires the host's agent tools (`mcp.injectIntoAgents`, on by default). Workbench shows a warning if they are off and never changes that setting.

## Prerequisites

- Paseo **0.12.0** or later with **Enable plugins** on (Settings > Plugins).
- An authenticated provider on the host (Claude for enforced read-only reviews).
- Node.js ≥ 22.18 and npm (22.18+ only for the integration tests, which use native type stripping).

> **Trust boundary:** Paseo plugins are unsandboxed. Workbench's server part writes only inside `<PASEO_HOME>/plugin-data/workbench` (Coordinator homes and `state.json`, its registry of Coordinators and second-opinion pairs), but it runs with the daemon user's rights and answers allowed Paseo-tool permission requests for registered Coordinators. Inspect the source before installing.

## Install

On the machine that runs the target Paseo daemon:

```bash
git clone https://github.com/julien-bloch/paseo-workbench.git
cd paseo-workbench
npm ci
npm run typecheck && npm run test:unit
paseo plugin install "$PWD"          # add --host <host:port> for a non-default daemon
paseo plugin ls                      # expect: workbench  running  yes
```

Or paste the absolute directory into **Settings > Plugins > Plugin source**. If it does not reach `running`, check `paseo plugin logs workbench`. After editing the source, run `paseo plugin reload workbench`; do not restart the daemon.

Coordinators need the host's agent tools (Paseo's default). Everything else Workbench does is a plugin-side SDK call made when you click.

## First-time workflow

1. **Settings**: pick a default model. For committee reviews (the Reviewer's default), set the Reviewer's **Second reviewer model**.
2. **Launch** > a specialist > **In a workspace** > **One time** > the workspace > scope, review mode, task (optionally **Show prompt**) > **Launch**. Also available from a workspace's **Workbench specialists** panel or ⌘K on an agent. Pick **Scheduled** and a cadence instead to run it regularly.
3. **Launch** > a specialist > **Across projects** > projects, existing agents it takes over (optional) and, for a PR manager, which PRs to watch > **Launch coordinator** (or, with **Scheduled**, **Launch and schedule check-ins**). You land in **Command**: its controls on top (projects, watched PRs, refresh context, snapshot, edit), its chat and its agents below.
4. **Command** shows what needs you on top. **Overview**: all agents by who started what; tap a row to open that agent, **Summarize** for a session summary.

## Data and model costs

- Settings (profiles, Coordinators, default model) live in this host's Paseo plugin settings and are saved with conflict protection: a save over another device's newer change is refused, and your draft is kept. Use **Settings > Export** to copy them before uninstalling. Project notes from earlier versions are kept there, unused.
- Each Coordinator's `CONTEXT.md` holds its assignment, project and workspace names, workspace and agent IDs, and agent titles/statuses, written only on Create or Refresh.
- The overview polls Paseo metadata every 15 seconds while visible. It never calls a model.
- **Create**, **Refresh context** and **Launch** spend tokens when clicked. A second opinion or committee adds the second model's time and tokens; a committee runs three rounds (review, cross-check, consensus).
- **Coordinators keep spending after you click**: they start and message agents on their own. Archive a Coordinator in Paseo to stop it.
- **Schedules spend on their cadence** until you pause or delete them under **Schedules**. Deleting a coordinator's agent does not delete its check-ins; remove them there.

## Tests

```bash
npm run typecheck
npm run test:unit                                  # pure logic, no daemon
```

Integration tests need a **disposable** daemon. They refuse the default production port 6767 and create agents with a small model:

```bash
mkdir -p /tmp/wb-dev/home
echo '{"version":1,"daemon":{"listen":"127.0.0.1:6868","relay":{"enabled":false},"mcp":{"injectIntoAgents":true}},"pluginsEnabled":true}' > /tmp/wb-dev/home/config.json
paseo daemon run --home /tmp/wb-dev/home &          # separate home: production is untouched
paseo plugin install "$PWD" --host 127.0.0.1:6868
WORKBENCH_TEST_DAEMON=127.0.0.1:6868 npm run test:integration
# optional: WORKBENCH_TEST_MODEL=claude/<model>  WORKBENCH_TEST_CODEX_MODEL=codex/<model>  WORKBENCH_TEST_SECOND_MODEL=<provider/model>
# needs github.com for the pull-request test (public octocat/Hello-World); a Codex login for the Codex tests
paseo daemon stop --home /tmp/wb-dev/home
```

## Known issues

- **Paseo's workspace archive deletes a worktree's folder even with uncommitted changes**, without asking. Workbench checks first and asks; Paseo's own sidebar does not. Branches are kept, so committed work survives.

- **Small models may miss Paseo's tools.** Claude Code loads MCP tools on demand; Coordinator and PR manager instructions say to search for "paseo" first, but Claude Haiku sometimes still tries the shell instead. That stops at a permission prompt (nothing runs). Use a stronger model for coordinators.

- **Schedules use the `paseo` CLI** from the plugin server (the plugin SDK has no schedule API): `PASEO_CLI`, else the macOS app's bundled CLI, else `paseo` on `PATH`. Check-ins (Paseo heartbeats) cannot be listed by the CLI, so Workbench lists the ones it created; it cannot pause them, only remove them. Schedules created on one host are listed only when that host is selected.
- **Taking over agents also uses the CLI** (`paseo agent update --label`, `paseo agent detach`): the SDK cannot change an existing agent's labels.

- **The Command tree can lag the chat by up to 15 seconds**: the chat follows Paseo live, the tree comes from the directory poll.
- **Your Claude Code always-allow rules apply to Workbench's Claude agents too.** Commands you set to always-allow (for example `Bash(gh pr:*)` or `Bash(uv run:*)` in `~/.claude/settings.json`) run without asking even in plan mode, so a "read-only" Reviewer is read-only only for commands outside those rules. The PR manager additionally denies `gh pr merge` and `git push` for itself.
- **Native mobile app not tested.** UI was verified in Paseo 0.12's web build at desktop and iPhone viewports, not in the iOS/Android app or the Electron shell.
- **Codex read-only is requested, not verified per launch.** Tested once against a writable control on 0.12; Paseo cannot confirm it for each agent.
- **A Coordinator's workspace assignment is guidance, not enforcement.** Its instructions and `CONTEXT.md` restrict it, but Paseo's `create_agent` accepts any workspace on the host. Agents it starts outside the assignment would still show as its children in Activity.
- **Coordinators act through the agent tools of their own host only**, so assignments are limited to that host's workspaces.
- **Second-opinion delivery** happens in the plugin's server process. Pairs and delivered reports are persisted, so a restart neither loses nor repeats a report, but a report that finished while the plugin was stopped is forwarded at the next agent turn end on the host. The second opinion is always readable directly as the main reviewer's child.
- **Plan mode is approval-gated, not absolute:** approving a write permission, or "Implement", lets the Reviewer edit.
- **Native subagents are live-only.** Children that started or finished before the Overview tab opened are missing. Proposal: [docs/NATIVE_SUBAGENT_SDK_PROPOSAL.md](docs/NATIVE_SUBAGENT_SDK_PROPOSAL.md).
- Polling every 15 seconds rather than owned subscriptions (WB-009).
- Settings are one document per host, so saving one profile while another device saved a different one asks you to save again (no data lost).
- Profiles and the default model live on the plugin's host. A specialist launched on another host uses that host's provider, and a missing model there fails at launch.
- If two devices create the same Coordinator at the same moment with *different* settings, and the user clicks **Start a new one** before the other creation finishes, two agents for it can exist. Archive one.
- Coordinators started before 0.1.0-alpha.15 keep running in their own folders (each its own project in Paseo's sidebar); start a new one to move it into the shared **coordinators** project.

See [docs/ENGINEERING_SPEC.md](docs/ENGINEERING_SPEC.md), [docs/ENGINEER_HANDOFF.md](docs/ENGINEER_HANDOFF.md) and [docs/IMPLEMENTATION_BACKLOG.md](docs/IMPLEMENTATION_BACKLOG.md).

## Official SDK references

- https://paseo.sh/docs/plugins
- https://paseo.sh/docs/plugins/reference
- https://paseo.sh/docs/sdk/agents
- https://paseo.sh/docs/sdk/reference
