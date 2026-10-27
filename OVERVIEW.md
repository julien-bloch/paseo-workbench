Workbench brings agent activity, coordinator conversations and specialist launches into one Paseo screen. **Command** shows what needs you, what is running and what just finished, and lets you chat with coordinators; **Launch** starts specialists and coordinators; **Overview** follows agent teams and manages worktrees. A badge beside Workbench in the sidebar counts agents by status, with Paseo's own colours: needs input, failed, working, ready to review.

## Setup

- Paseo 0.12.0 or later, with plugins enabled. Installation steps are in the [README](https://github.com/julien-bloch/paseo-workbench#install).
- An authenticated agent provider (Claude Code or Codex) on each host where you launch work. Choose a default model in Workbench's Settings; for a second opinion or committee review, also choose that specialist's second reviewer model.
- Coordinators need Paseo's agent tools on their host (the daemon's `mcp.injectIntoAgents` setting, on by default). Workbench does not change that setting.
- Schedules, renaming coordinators and assigning existing agents to a coordinator use the Paseo CLI on the host: `PASEO_CLI` when set, otherwise the macOS app's bundled CLI, otherwise `paseo` on the command path.
- Pull-request reviews and the PR manager also need Git and an authenticated GitHub CLI (`gh`).
- Tested on macOS with the Paseo desktop app, and in Paseo's web interface at desktop and phone sizes. The native mobile apps are untested.

## What it does

- **Specialists**: launch a built-in or custom specialist (Coordinator, Reviewer, Experiment reviewer, Debugger, Session summarizer, PR manager, Writer, or your own) on uncommitted changes, a branch, a pull request, an agent's conversation or a task you describe. Pull-request reviews run in a separate Paseo worktree, reused for the same pull request.
- **Review modes**: a single review, a second opinion from another model, or a two-member committee that exchanges reviews and writes a consensus. Workbench relays the reports between the agents.
- **Coordinators**: persistent agents for one workspace or several projects. Chat with them in Command, answer their questions there, and let them start, message and cancel agents. You can hand existing agents to a coordinator and release them later.
- **Schedules**: recurring specialist runs in a workspace, or recurring check-ins for a coordinator, through Paseo's scheduler. Workspace schedules can be paused, resumed or deleted; check-ins can be removed.
- **Your own specialists**: read from Markdown files in a folder you choose on the host, or imported from another host's export. Each specialist can name skills the agent is told to load first.
- **Cleanup**: archive finished agents from Overview, and remove worktrees with Paseo's archive after seeing whether they hold uncommitted changes.

## Data and storage

- Workbench reads workspace and agent metadata, pending permissions and, when you ask for a summary or open a coordinator chat, agent conversations, through Paseo.
- Prompts, selected conversations, project context and review reports that Workbench gives to agents are processed by the provider each agent uses, which may be a remote service. Agents read repository files and use tools according to their provider permissions.
- Specialist settings live in Paseo's plugin settings on the host. Coordinator context files, the coordinator registry and review-relay state live under `plugin-data/workbench` in the daemon's data directory. Context files list project and workspace names, agent IDs, titles and statuses.
- Workbench adds no external service and downloads no software.

## Permissions and costs

- **Coordinators act on their own.** For coordinators Workbench registered, it automatically approves a fixed set of Paseo agent-management requests (list, inspect, create agents, send prompts, cancel). Requests for permission-bypassing modes, and everything else (file edits, shell commands, archiving agents, answering another agent's permission request), still ask you.
- **PR managers** may also open a pull request's worktree and start fixer agents in modes that ask before shell commands, without asking you, and get a fixed set of read-only commands approved. Every argument is checked against an allowlist: `gh pr list/view/checks/diff/status`, `gh run list/view`, `gh api` for plain reads only (no method changes, request bodies, headers or GraphQL), and `git -C <dir>` status, log, diff, show, rev-parse, `remote -v`, fetch without writing local branches, and branch listing. Any other command, including merges and pushes, asks you.
- **Read-only specialists** run in Claude's plan mode or request Codex's read-only sandbox. Your Claude Code always-allow rules still apply, approving a write permits it, and Workbench cannot confirm Codex's sandbox at each launch.
- **Costs**: coordinators keep using model tokens while they delegate, schedules run on their cadence, and second opinions and committees add model calls. Archive a coordinator and remove its check-ins to stop it.
- **Worktrees**: removing a worktree deletes its folder (the branch stays) and archives its agents. Workbench shows uncommitted changes and asks before discarding them. Archiving the last agent of an unused, clean Workbench pull-request review worktree also removes that worktree.

## Limitations

- Coordinators act only through their own host's agent tools. A coordinator's project assignment guides it; it does not isolate files.
- Agent lists update live as agents change (with a 15-second refresh as a fallback). Provider-native subagents appear only while the view is open and their events are observed.
