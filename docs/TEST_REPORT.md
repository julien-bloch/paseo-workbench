# Test report: Workbench 0.1.0-alpha.13

Run on 2026-10-21, macOS (Apple silicon), Node 22.19.0, **installed Paseo 0.12.0** (`paseo --version`; daemon and app bundle 0.12.0). Nothing ran against the production daemon (`~/.paseo`, port 6767) or a user repository.

## Environment

| Piece | Setup |
|---|---|
| Dev daemon A | `paseo daemon run --home /tmp/wb-dev/home`, listen `127.0.0.1:6868`, relay off, MCP injection off, plugins on |
| Dev daemon B (multi-host) | `paseo daemon run --home /tmp/wb-dev/home2`, `127.0.0.1:6869`, plugins off |
| Plugin | `paseo plugin install /abs/path/to/paseo-workbench --host 127.0.0.1:6868` → `workbench running yes` |
| Repo under test | Scratch git repo from `mkdtemp` with one committed file and one uncommitted off-by-one |
| Models | `claude/claude-haiku-4-5` with one-line tasks. Codex was used only for no-token create/refusal checks |
| UI | Paseo's own web build (`Paseo.app/Contents/Resources/app-dist`) served on `127.0.0.1:8099`, driven by Playwright Chromium; daemon CORS allows that origin only |

## Commands and results

```text
npm install                       ok (after aligning react 19.1.0 / react-native 0.81.5 with @getpaseo/plugin@0.12.0 peers)
npm run typecheck                 0 errors
npm run test:unit                 13/13 pass (incl. pre-load headline, host coverage)
WORKBENCH_TEST_DAEMON=127.0.0.1:6868 npm run test:integration   12/12 pass
paseo plugin ls --host 127.0.0.1:6868                            workbench running yes
```

Integration suite (`tests/integration/workbench.integration.test.mjs`, real daemon, real agents):

| # | Test | Result / evidence |
|---|---|---|
| 1 | Scratch repo listed as a project, real directory, `(serverId, projectId)` key | pass |
| 2 | Host settings store rejects a stale revision (`conflict`), keeps the earlier save | pass |
| 3 | Pre-existing settings documents load with safe defaults (`requireReadOnly: true`) | pass |
| 4 | Coordinator home is `<daemon home>/plugin-data/workbench/coordinator`; `CONTEXT.md` mode 0600; 120 001-char payload rejected | pass (`/tmp/wb-dev/home/...`, not `~/.paseo`) |
| 5 | Unknown provider, non-read-only mode on a read-only profile, unknown mode, missing model are refused **before** any agent exists | pass (agent count unchanged) |
| 6 | Reviewer: fresh session, `cwd` = scratch repo, `currentModeId: plan`, no parent label, file untouched, review mentions `len(xs) - 1` | pass |
| 7 | Plan-mode Reviewer told to use Write | pass: `Write:failed`, permission `tool:Write` raised and denied, file absent |
| 8 | Plan-mode Reviewer told to run `echo pwned > file` | pass: `Bash:failed`, permission `tool:Bash` raised and denied, file absent |
| 9 | Codex read-only profile refused; Paseo rejects `modeId: "read-only"` for Codex | pass |
| 10 | Helper launched from an agent carries `paseo.parent-agent-id`, nests at depth 1 | pass |
| 11 | Two concurrent `createCoordinator` → same agent id; retry → same; different settings → refused; archived → same key returns archived; next generation → new agent | pass |
| 12 | Live `agent.provider_subagents.update` events (`upsert`, `timeline`, `remove`) map a real Claude subagent beneath its managed parent | pass (`general-purpose:completed`) |

## alpha.13 additions

| Check | Result |
|---|---|
| `npm run test:unit` | 35/35 (upgrade-step tests for removed pre-release versions dropped; one test pins the default specialist set) |
| Full integration suite | 21/22 on the first run. The PR manager test failed twice in a row: Claude Code 2.1.296 defers MCP tools, and Haiku's tool search missed `create_workspace`, so it tried `curl` (a shell command that stops for permission). After the instructions told it to search for "paseo", it passed 2 of 3 runs; the remaining failure is the same safe fallback. Coordinator orchestration and schedules/take-over pass |
| Picker | with "Every project on this host" no workspace lists show; selecting a project shows its workspaces (desktop + phone, no page errors) |

## alpha.12 additions (generic defaults, skills, specialists folder, import)

| Check | Result |
|---|---|
| `npm run test:unit` | 40/40 (new: public defaults name no personal skills or domain terms; skills become one "load these first" line in specialist and coordinator prompts, invalid names rejected; specialist files parse header + body, with specific errors for unknown keys, bad booleans, bad ids and empty instructions; folder files replace built-ins in place; import replaces by id, adds new, refuses invalid JSON, invalid entries and more than 20) |
| Full integration suite | 22/22 pass on the test daemon |
| Integration "specialists folder" | server lists only `*.md` (README.md skipped) from the folder in settings; missing folder and relative path give clear errors |
| Sample folder | a `reviewer.md` and an `experiment-reviewer.md` with `skills:` headers parse to ids reviewer / experiment-reviewer with their skills, Reviewer committee by default |
| Desktop + phone UI | with the folder set: Settings shows "Loaded from …: Experiment reviewer (… replaces the built-in); Reviewer (…)", the Skills field and Import; Launch > Reviewer shows its "Skills: …" line and Show prompt contains the skills line. No page errors |

## alpha.10 additions

| Check | Result |
|---|---|
| `npm run test:unit` | 37/37 (new: picker toggles: none→all, all→"all but one" as single workspaces, last one back→whole project, some→all, other projects' workspaces untouched) |
| Desktop + phone UI | General coordinator > Across projects: tapping Hello-World (2 workspaces) shows "✓ Hello-World ▾" and its workspaces; tapping "master" leaves "◐ Hello-World ▾", "1 workspace(s)". No page errors. Command's selector uses the same component (not clicked through: it needs a running coordinator) |

## alpha.9 additions

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run test:unit` | clean; 36/36 (new: v8 makes the PR manager not coordinator-only, its coordinator instructions are not wrapped, the pull-requests prompt names this repository only, both filters and "asks the user first") |
| Desktop + phone UI | Reviewer: "What should it look at?" with the five plain choices and an explanation line; Experiment reviewer starts on "Something else" ("What should it do?"); PR manager offers In a workspace with "Pull requests to check" chips and no Review block, its Show prompt contains the workspace-only scope; across projects it reads "Runs as a coordinator" with no "expertise" wrapper; Settings shows "Undo changes" and the "Create a new specialist" block. No page errors |

## alpha.8 additions (one launch form, schedules, take-over, fewer specialists)

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run test:unit` | 35/35 pass (new: settings v7 drops unedited Researcher/Architect/Results reviewer/Experiment summarizer, keeps an edited one, adds Experiment reviewer once, General coordinator first, idempotent; a renamed coordinator keeps its name) |
| CLI probe (0.12.0) | `paseo schedule create … --json` returns `{id,name,cadence,target,status,nextRunAt}`; pause/resume/inspect/delete work; `paseo heartbeat create` with `PASEO_AGENT_ID` targets that agent, but heartbeats are invisible to `schedule ls/inspect/pause` (hence Workbench records them and can only remove them); `paseo agent update --label paseo.parent-agent-id=<id>` makes Paseo report `ParentAgentId`, `paseo agent detach` clears it |
| Integration "schedules and take-over" | workspace schedule created through the plugin RPC with `--mode plan` and the workspace's directory, listed, paused, resumed, deleted; unknown workspace, `bypassPermissions` and a malformed cron refused; check-in refused for a non-coordinator, created/listed/removed for a registered one, pause refused; adopt refused for an unregistered coordinator, adopts a plain agent, skips a coordinator and another agent's child, release only for its own subagents; the coordinator's timeline has both notices |
| Full integration suite | 21 tests: 20 pass on the first run. "session summarizer" failed once because Haiku's summary did not quote the transcript's key phrase (the prompt did contain it; that assertion passed). It passed on rerun, as did "schedules and take-over" after the argv hardening (`--opt=value`, ids and modes must start with a letter or digit). This is model wording, a known flake |
| Defect found and fixed | the `--` that keeps a prompt starting with "-" from being read as an option also swallowed `--json` (CLI printed a table); options now go before `--`, and unparseable CLI output is an error instead of `undefined`. A prompt `--help me: reply OK.` is stored verbatim |
| Desktop UI (web build, 1400×1100) | What chips: General coordinator, Reviewer, Experiment reviewer, Session summarizer, PR manager (Debugger was deleted earlier on this test host); no "Launch a specialist" section; Where/When chips; Scheduled + Codex default model → clear "cannot request Codex's sandbox" refusal; with Claude Haiku: Schedule Reviewer → "Scheduled … weekdays at 9:00 … Enforced read-only (plan) … Next run …", listed under Schedules, deleted from there; empty custom cron disables the button; PR manager offers only Across projects; take-over picker → coordinator launched, Paseo shows the agent's parent, **Release** clears it; after archiving every coordinator, Command says "No coordinators running". No page errors |
| Phone UI (390×844) | same flow, no page errors; screenshots `/tmp/wb-dev/shots/l5-phone-*.png` |

## alpha.3 additions (same environment; integration suite now 17 tests, unit 19)

```text
npm run test:unit                 19/19 pass
WORKBENCH_TEST_DAEMON=127.0.0.1:6868 npm run test:integration   17/17 pass (agent tools on, Codex logged in, github.com reachable)
```

| Test | Result / evidence |
|---|---|
| Paseo Claude agents load `~/.claude/skills` | Probe via `agent.commands()`: the host's installed skills are listed |
| Settings migration on a real stored v1 document | Results reviewer added, Reviewer text updated only because unedited, 7 notes kept; then v2→v3: single Coordinator became `default`, edited instructions and generation 1 kept |
| Codex read-only sandbox | Writable control (`workspace-write`) wrote the file; sandboxed Reviewer's write failed ("operation not permitted"); title shows "read-only sandbox". First attempts were inconclusive (a model reported commands it never ran; a control in an untrusted folder was read-only by Codex's own default), hence the explicit control |
| Pull request scope | New worktree at `refs/pull/1/head` (octocat/Hello-World), plan mode; source checkout HEAD and status unchanged |
| Second opinion | Codex second opinion created and mode-planned before either task was sent; relay delivered exactly one `[Workbench second opinion]` message after both finished; Claude Reviewer replied with a verified-findings table |
| Multiple Coordinators | Separate homes (`coordinator`, `coordinators/c-test`), separate agents, `workbench.coordinator-id` labels; `../escape` id rejected |
| Coordinator orchestration | Registered Coordinator assigned to the scratch workspace started an agent there by itself (plugin log: "auto-approved Paseo tool create_agent"); the child is its Paseo child. `archive_agent` stayed pending; a `create_agent` with `bypassPermissions` stayed pending ("left create_agent for the user") and no bypass child exists |
| First design that failed | Pre-approving tools via the SDK `toolPolicy` is rejected by the daemon (the Paseo tool server is injected with a private per-run token), so approval moved to a plugin permission hook |
| UI (desktop and iPhone viewport) | Coordinators list, add, workspace assignment, save; second-opinion model in Settings; launcher Pull request field (Launch disabled until a number), second-opinion checkbox with its permission line; no page errors |

### Second Codex review (read-only, on the alpha.3 diff)

| Finding | Verified? | Action |
|---|---|---|
| Relay's "just-ended agent is not busy" exemption let a queued older turn-end send into a running turn | Yes (code) | Exemption removed; busy primary or lagging status → retry every 5 s (≤10 min), and the next turn end retriggers |
| Coordinator autonomy trusted labels any agent's `create_agent` can set (also detached roots) | Yes (Paseo source: labels pass through; detached relationship exists) | Server registry: the UI registers a Coordinator via RPC; the server verifies labels, no parent, and that it runs in that Coordinator's own home. Only registered agents get auto-approvals. Integration #16: forged one refused |
| Relay trusted the second-opinion label | Yes (code) | Pairs registered via RPC and verified (both Workbench helpers, second is the primary's child with the label). #16: forged pair refused |
| Reports missed while the plugin was stopped, or after a failed send, were never delivered | Yes (code) | Pairs persisted; sweep on the first event after start; failed sends retried |
| Dedup searched only the last 1000 timeline items; user text containing the marker could suppress delivery | Yes (code) | Delivered report hashes persisted per pair; no timeline scanning |
| Follow-up report from the same second reviewer never relayed | Yes (code) | Dedup is per report, not per agent |
| If the second reviewer's task failed after the primary started, the error hid the running primary | Yes (code) | Error names the running primary; the pair is registered with the failure, so the primary is told why no opinion arrives |
| Symlinked coordinator home could redirect writes | Yes (#16: symlink to an outside dir) | Real path of each home must stay inside the real plugin directory; write refused, nothing written outside |
| Migrations, permission ordering, read-only propagation, PR placement | No issue found | — |

## alpha.6 additions (PR manager)

| Test | Result / evidence |
|---|---|
| Read-only allowlist (unit) | 8 read commands allowed; 17 refused (merge, comment, checkout, review, --web, POST/-f, push, chaining with ; && \| $( ) backticks, redirection, cd &&) |
| PR manager live (public octocat/Hello-World) | `gh pr list` ran without asking; `gh pr merge` refused by a deny rule ("Permission … has been denied") despite the user's `Bash(gh pr:*)` always-allow; a worktree at `refs/pull/1/head` and a fixer in `acceptEdits` started without asking; source checkout clean |
| Plan mode vs always-allow rules | Found: with the user's `Bash(gh pr:*)` rule, a plan-mode agent executed `gh pr merge` (GitHub refused only because the PR was unmergeable). A `disallowedTools` deny rule blocked it. Claude Code's sandbox blocked a `uv run` file write. Per the user's preference, Workbench only labels this and denies merge/push for PR managers |
| UI | + New PR manager, Select PRs to watch with "Watches:" pills, snapshot lists the watch rules; no page errors |

## alpha.5 additions (Command tab, summarizers)

```text
npm run test:unit                 29/29 pass
WORKBENCH_TEST_DAEMON=127.0.0.1:6868 npm run test:integration   19/19 pass (+ exactly-once relay check)
```

| Test | Result / evidence |
|---|---|
| Command tab in the web build | Transcript rendered (Workbench's first prompt collapsed, tool one-liners, context 15%); Enter sent a message; the Coordinator's AskUserQuestion appeared as a form; Answer disabled until a choice; after "Blue", the form disappeared and the reply mentioned blue; phone viewport stacks chat and tree; no page errors |
| Session summarizer | Read another agent's conversation from Paseo (prompt contains it between markers), ran in plan mode, summary quoted it |
| Exactly-once relay | Re-registering a delivered pair (server record reset) did not produce a second relayed message: the relay id in the target's timeline blocked it |

### Third Codex review (read-only, on the alpha.5 diff)

| Finding | Verified? | Action |
|---|---|---|
| Committee member / second reviewer could get a weaker mode than a non-read-only primary with a chosen mode | Yes (code) | Same mode when the provider is the same |
| A send whose acknowledgement was lost, or a crash before recording, could be repeated | Yes (Paseo has no message de-duplication) | Each relay message carries a stable relay id; skipped if already in the target's timeline (tested) |
| The idle check could go stale before the send, interrupting a new turn | Yes (code) | All relay sends steer instead of interrupt |
| Post-restart sweep waited for an unrelated turn end | Yes (code) | Sweep on any agent event or registration RPC (the plugin server has no Paseo access before one) |
| A reply that repeats earlier text stalled the committee | Yes (code) | Completion detected by any reply after the relay message, not by different text |
| A committee/second opinion that failed to form degraded to a single review | Yes (code) | Both agents are archived before any task is sent and the launch is refused with the reason |
| Question answers, composer, cleanup on switch, migrations v4/v5, attention filtering | No issue found | — |

## alpha.4 additions

```text
npm run test:unit                 25/25 pass
WORKBENCH_TEST_DAEMON=127.0.0.1:6868 npm run test:integration   18/18 pass
```

| Test | Result / evidence |
|---|---|
| Committee (Claude chair + Codex member) | Member received the chair's review exactly once; chair received the member's review, then its response; chair wrote a "Committee Consensus" table with an Agreed? column; file untouched |
| Settings stale-revision test | Was order-dependent: a save that leaves the document identical need not advance the revision. The test now always makes a real change; passes repeatedly |
| UI | Projects pane gone; **+ New coordinator** opens project selection; selecting a project shows ✓ and "1 selected", saving shows "Coordinates: <project>"; Review chips Single / Second opinion / Committee with the Reviewer preselected to Committee; deleting a profile needs a confirm click; no page errors (desktop and iPhone viewport) |

## UI checks (web build of the 0.12 app)

| Check | Result |
|---|---|
| Desktop 1400×900, dark: all four tabs | Render; no page errors; nothing past the right edge |
| Light theme | All text readable (theme colors only) |
| Phone viewport (iPhone 13 emulation, compact layout) | **Bug found and fixed:** long project chips were clipped. Now wrap |
| Model picker | Lists this host's 25 models from `providers.listModels`; no default model → explicit "Workbench does not guess" warning; Create Coordinator disabled with reason |
| Two app instances editing the same project's notes | B saves; A's draft is kept, "changed on another device" shown; A's save is refused, not overwritten; Discard loads B's notes |
| Both instances click Create Coordinator at once | One Coordinator (`agents.list` label filter returns exactly one) |
| Launch Reviewer from Helpers tab | Opens in Paseo's normal agent view showing "Haiku 4.5 · Plan mode" |
| Workspace panel and agent panel from ⌘K | Both commands present; both panels render the launcher with the read-only label |
| Second host online | "2 of 2 hosts read"; same-named projects disambiguated by host |
| Second host stopped | "1 of 2 hosts read", named host error, Needs attention says status unknown (no all-clear) |
| Daemon restart | Coordinator rediscovered by label (status `closed`); notes, model and generation persisted; `CONTEXT.md` intact; sending to the closed Coordinator resumes it |
| Plugin disabled | Sidebar item gone; agents/workspaces and the Reviewer tab still work; no page errors |

## Defects found by these tests and fixed

1. devDependencies conflicted with the 0.12 SDK peers (`npm install` failed).
2. `workspace.directory` does not exist in 0.12 (`workspaceDirectory`).
3. Model was guessed from other agents; now explicit only.
4. Codex `read-only` cannot be requested or verified on 0.12; it is no longer offered as read-only.
5. `parent` option fails with "Caller agent … not found" when the parent is closed (any agent after a restart); now writes Paseo's parent label directly.
6. Offline hosts were silently dropped (false all-clear).
7. Concurrent Coordinator creation could create duplicates; another device's save erased unsaved drafts.
8. Coordinator home appeared as a user project; colliding host labels were ambiguous; chips overflowed on phones.
9. After archiving a Coordinator and changing settings, Create hit a permanent key conflict ("another client…"). Now Workbench opens a live Coordinator if one exists, else offers **Start a new Coordinator** (compare-and-set generation). UI reproduction: conflict message and button shown → one new live Coordinator, generation 0 → 1.
10. With no explicit project selection, a poll that re-sorted projects swapped the notes editor to another project and discarded the draft. Selection is now pinned; the Activity filter has its own state.
11. Before the first directory read, Needs attention said "No recorded agent attention items". It now says "Agent status not read yet." (unit test).

## Second-opinion review (Codex, read-only, on the branch diff)

| Finding | Verified? | Action |
|---|---|---|
| "Start a new Coordinator" could race another device's in-flight create with different settings | Yes (code reading; needs a click during that race) | Re-checks for a live Coordinator on click; remaining window documented in README |
| Task `send` failure after start hid the created agent, so retry duplicated it | Yes (code) | Error now names the created agent and says to check it before relaunching |
| A newly added/offline host kept the previous all-clear until the next read completed | Yes (code) | Coverage derived every render from the live host list (`hostGaps`, unit-tested); offline hosts' rows hidden |
| An old `refresh` callback could overwrite newer host errors | Yes (code) | `refresh` reads the current host list via a ref; gaps derived from live hosts |
| Truncated directory still counted as fully read | Yes (code) | Truncated host is a coverage gap |
| Two context writes in the same millisecond collided on the temp file | Yes (integration #4 now writes twice concurrently) | Temp name uses `randomUUID()` |
| Claims A (read-only before task) and C (no stale overwrite) | No issue found | — |

After these fixes: typecheck clean, unit 13/13, integration 12/12, UI offline and two-device conflict flows re-run.

## Not verified (honest gaps)

- **Native iOS/Android Paseo app and the Electron desktop shell.** UI was checked in the bundled web build at desktop and phone viewports, not on a device. The production desktop app is attached to the production daemon, which was deliberately left untouched.
- **A remote host over the relay.** Multi-host was tested with two local daemons over direct TCP.
- Providers other than Claude and Codex.
- Large directories (>200 agents/workspaces per page); paging code is unchanged from the handoff.
