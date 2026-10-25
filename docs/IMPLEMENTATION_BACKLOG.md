# Workbench implementation backlog

This backlog converts ENGINEERING_SPEC into actionable engineering tickets. Priorities are P0 = release blocker, P1 = next iteration, P2 = enhancement. Status updated 2026-10-21 against installed Paseo 0.12.0; an item is Done only with the evidence shown.

| ID | Priority | Work item | Status | Evidence (see docs/TEST_REPORT.md) |
|---|---|---|---|---|
| WB-001 | P0 | Install against real Paseo v0.12 | **Done** | `npm install`, `npm run typecheck` (0 errors), `paseo plugin ls` → `workbench running`, screen opens in the 0.12 web build |
| WB-002 | P0 | Scratch-project launch test | **Done** | Integration #6: Reviewer `cwd` = scratch repo, correct workspace, opens in normal Paseo agent view |
| WB-003 | P0 | Coordinator lifecycle | **Done** | Integration #11 (concurrent create → one agent, archive → next generation); UI double-click → one agent; restart → rediscovered, context file kept |
| WB-004 | P0 | Model and permission UI | **Done** | Model and mode pickers from `providers.listModels/listModes`; no guessing; unknown mode refused (integration #5) |
| WB-005 | P0 | Reviewer isolation guarantee or warning | **Done (Claude); limitation (Codex)** | Integration #7/#8: plan-mode Write and shell writes raise permissions, nothing written. Mode verified via `currentModeId` before the task is sent. Codex refused with explanation (#9) |
| WB-006 | P0 | Offline and reconnect correctness | **Done** | Stopped host → "1 of 2 hosts read", no all-clear; unit test `attentionHeadline`; per-refresh sequence guard kept |
| WB-007 | P0 | Phone / responsive QA | **Partial** | Web build at iPhone 13 viewport and desktop, dark and light; overflow bug fixed. Not run in the native iOS/Android app |
| WB-008 | P0 | Export and privacy controls for notes | **Done (basic)** | Snapshot preview before write/send; selectable JSON export of notes and profiles; no automatic ingestion |
| WB-009 | P1 | Owned agent/workspace subscriptions | **Done (agents)** | alpha.25: Paseo's agent-list subscription refreshes about a second after any agent change (measured 0.4 s for a permission request); 15-second refresh as fallback. Workspaces still refresh with it |
| WB-010 | P1 | Native subagent SDK proposal | **Proposal written; deferred** | docs/NATIVE_SUBAGENT_SDK_PROPOSAL.md. Owner decision 2026-10-21: no upstream Paseo PR for now; keep the live-only view |
| WB-011 | P1 | Native-child drilldown | Open | Blocked on WB-010 |
| WB-012 | P1 | Structured review results | Open | |
| WB-013 | P1 | Project-level profile overrides | Open | |
| WB-014 | P1 | Better attention queue | Open | |
| WB-015 | P1 | Audit and secure plugin storage | Open | Fixed directory, 0600 file and atomic rename verified (#4); symlink audit not done |
| WB-016 | P2 | Optional review-on-completion | Open | Do not start before manual review is trusted |
| WB-017 | P2 | Provenance-based memory | Open | |
| WB-018 | P2 | Cross-host coordinator context refresh | Open | Snapshot already lists unreachable hosts as unknown |
| WB-019 | P1 | Reviewer uses the user's review skill; Results reviewer | **Done** | Probe: Paseo Claude agents load `~/.claude/skills`; unit test for v2 migration (keeps edited instructions); live v1→v2 migration kept 7 notes |
| WB-020 | P1 | Pull request review in its own worktree | **Done** | Integration #10: agent HEAD = `refs/pull/1/head` of octocat/Hello-World; source HEAD and status unchanged |
| WB-021 | P1 | Opt-in second opinion on any model | **Done** | Integration #11: Codex second opinion relayed exactly once; Claude reviewer verified it in a table |
| WB-022 | P1 | Codex read-only (requested sandbox) | **Done (labeled limitation)** | Integration #9: write blocked; writable control wrote |
| WB-023 | P1 | Multiple Coordinators with workspace assignment and autonomy | **Done** | Integration #14/#15: separate homes/agents; coordinator started an agent in its workspace; `archive_agent` and bypass `create_agent` stayed pending; UI flow (add, assign, save) desktop + phone |
| WB-024 | P2 | Enforce Coordinator workspace assignment | Open | Today instruction-level only; needs Paseo to scope agent tools per caller, or a plugin `before("agent.create")` hook that knows the caller |
| WB-025 | P1 | One launch form (What / Where it runs / When) and fewer specialists | **Done** | Unit (v7 migration); desktop + phone UI runs in TEST_REPORT alpha.8 |
| WB-026 | P1 | Scheduled specialists and coordinator check-ins via Paseo schedules | **Done (CLI-based)** | Integration "schedules and take-over"; UI scheduled Reviewer created, listed, deleted. Needs a plugin SDK schedule API to drop the CLI |
| WB-027 | P1 | Coordinator takes over existing agents; Release | **Done (CLI-based)** | Integration "schedules and take-over"; UI adopt + release. Needs an SDK label update to drop the CLI |
| WB-028 | P1 | Generic public defaults; skills field; specialists folder; import | **Done** | Unit + integration "specialists folder" + UI (TEST_REPORT alpha.12) |
| WB-029 | P1 | Public release: license, npm package (drop `private`, shrinkwrap, `files`), OVERVIEW.md with data disclosure, move handoff docs, registry submission | Open | Paseo publishing docs: npm or public GitHub, then registry form |
| WB-030 | P3 | Pick skills from those installed on the host | Open | Only if users ask; fills the same Skills field |

## Recommended implementation order

WB-001, WB-002, WB-004, WB-005, WB-003, WB-006, WB-007, WB-008; then improve observability and structure with WB-009 through WB-015. Do not begin WB-016 until manual Review meets accuracy and cost expectations.

## Integration pitfalls / test cases

- Agent list and workspace list paging return `nextCursor`. Ensure stable paging under directory changes; reconcile over-fetch or duplicate entries.
- The current root UI does not guarantee project notes are visible to a Coordinator until **Refresh project context** is requested. This is deliberate and should be plainly communicated.
- A helper started from a parent agent has Paseo-managed parent metadata. This is not a Claude Code provider-native subagent and should not be represented as one.
- A native subagent may resume under a new tool-call ID while preserving provider identity; depend on Paseo's descriptor IDs, not tool call IDs.
- A provider child can be nested under another provider child, indicated by `parentSubagentId`. Native history requires a public list API and cannot be reliably reconstructed from live events alone.
- Do not silently infer a default branch for branch review. The reviewing agent should explicitly record base choice and assumptions.
- Permission mode IDs are provider-dependent, and model names change; discover them dynamically rather than hardcoding `plan` or a model string.
- User project notes may contain sensitive work context. Do not send them anywhere except a user-approved Coordinator or specialist run.
- The plugin is unsandboxed. Any new RPC that can touch the filesystem must validate inputs, enforce a constrained root, and be included in threat-model review.
