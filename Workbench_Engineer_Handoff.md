# Engineer Handoff: How to Finish Workbench

The deliverable is a **working TypeScript Paseo plugin source tree**, with a tested domain layer and an incomplete integration layer because the build environment had neither npm registry access nor a running Paseo daemon. The project should be treated as an alpha prototype and **not installed on a sensitive workstation without inspection**.

## First hour: validate plugin and fix SDK drift

1. On a development Mac or Linux host with Paseo >= 0.12.0, create a harmless scratch git repository. Confirm you can launch ordinary Paseo Claude/Codex agents there.
2. Copy/extract the package to a directory outside the scratch repository, then run `npm ci` if you have created a lockfile; otherwise `npm install`. Pin exact SDK versions after verification.
3. Run `npm run typecheck` and `npm run test:unit`. Fix any main-versus-release API discrepancies.
4. In Paseo Settings > Plugins, enable plugins with user approval. `paseo plugin install /absolute/path/to/paseo-workbench`, then `paseo plugin ls` (must be `running`). If not, use `paseo plugin logs workbench`.
5. Open the Workbench screen and exercise Project Overview, Settings save, and Launch Reviewer in the scratch repo. Validate `getPaseoClient` host mapping and `page` cursor behavior.

## Most likely integration issues to test

- **Actual model selection:** `provider/model` string needs to match installed provider catalog. Implement a dropdown backed by `providers.snapshot` / `listModels` instead of relying on manual strings in a beta.
- **Provider read-only mode:** `modeId` is provider specific. A prompt that says read-only is not permission enforcement. Test a reviewer attempt to write and verify it fails or requests approval. Add an enforced isolation option.
- **Coordinator directory on host:** `server/context.ts` uses `PASEO_HOME` or `~/.paseo`; verify daemon environment and filesystem permissions on Electron and separately launched daemons.
- **Action navigation:** `navigation.openAgent` should correctly open remotely hosted agent IDs in both desktop and phone clients.
- **Managed parent semantics:** `workspace.agents.create({parent: paseo.agents.ref(id)})` should preserve labels even when the parent is closed/idle. Prefer address-qualified parent for multi-host if later required.
- **`useSettings` in plugin UI:** Save/read/revision conflict should propagate to multiple clients. Check that component draft state does not lose edits during refresh.
- **Native subagent subscriptions:** With an agent running a Claude-native Task, confirm `agent.provider_subagents.update` events reach plugin surface in actual installed version. Built-in Paseo supports separate native child tracks; public listing still unavailable. Report unsupported versions clearly.
- **Large/long directories:** Directory loops at 25 pages of 200 and shows truncation. Ensure performance and filtering with many worktrees.
- **No host and offline host:** App host list may be empty or temporarily disconnected. Ensure the default/current host is correct and error cases are visible.
- **UI constraints:** Test React Native components and layout on desktop/browser/iOS/Android, especially narrow mobile, keyboard behavior and scroll.

## Required fixes before a public beta

1. **Run full SDK typecheck and real smoke tests**; fix compile issues. Currently only pure-unit tests are verified.
2. **Enforce or conspicuously disclose review permissions**. Add allowed-mode discovery and task isolation; avoid assuming a safe default.
3. **Make coordinator creation idempotent across clients** with an RPC that locks discovery/creation, or a durable per-host identity reservation. The current button prevents rapid repeat in one UI only.
4. **Harden observation lifecycle**: transition from 15s polling to owned subscriptions where possible; guard against old asynchronous responses overwriting newer host snapshots; reconcile after reconnect.
5. **Handle native subagent completeness**: visible 'live-only' indicator and no false empty state; pursue separate upstream SDK listing PR before claiming historical hierarchy.
6. **Better helper UX**: select model/mode from provider-supported list and choose precise diff scope/base; add task preview and estimated model cost where available.
7. **Give user explicit control over context**: preview snapshot before writing/sending, option to omit a project, redact paths if needed, show last-refreshed timestamp.
8. **Add integration tests** against Paseo and a scratch git repo. Cover child creation, permissions, restart, remote navigation, and error states.
9. **Clarify uninstall/backup** for host-scoped notes, and provide export/import of preferences and project notes.

## Suggested priority

Ship a trustworthy **Reviewer + global overview + project notes** first, Coordinator second if its host setup is troublesome. Full Claude-native historical tree can follow a clean SDK extension without blocking the core benefits.

## Source map

- `index.client.tsx`: Paseo screens, sidebar item, context panels and command actions.
- `index.server.ts`: settings and backend RPC registration.
- `shared/settings.ts`: host-saved preferences and editable role definitions.
- `shared/rpc.ts`: constrained coordinator home/context RPC contracts.
- `shared/model.ts`: pure project grouping and cross-provider tree projection.
- `shared/prompts.ts`: deterministic helper instructions and project context.
- `server/context.ts`: coordinator home and atomic snapshot file write.
- `client/data.ts`: connected-host directory and native-child event subscriptions.
- `client/actions.ts`: model resolution, normal Paseo helper creation.
- `client/WorkbenchScreen.tsx`: overview, coordinator, projects, activity, settings tabs.
- `client/HelpersPanel.tsx`: context-sensitive workspace and agent panels.
- `client/HelperLaunch.tsx`: explicit task/scope/role launcher.
- `client/SettingsEditor.tsx`: edit role/global configuration.
- `client/ui.tsx`: theme-aware reusable React Native controls.
- `tests/`: SDK-independent domain, prompt and hierarchy tests.

## Definition of done for v0.1 beta

All priority-M1 checks in ENGINEERING_SPEC pass on a supported Paseo version, and the UX requires no extra conceptual structures. A new user can: install plugin, select model, save notes for two projects, launch an independent Reviewer from one workspace, see the resulting normal Paseo agent, create Coordinator, refresh its context, and browse a meaningful agent hierarchy. The screen remains useful even if Coordinator or native child events are disabled.

**Do not reintroduce** a separate agent database, a shadow chat UI, obligatory workflows, or unbounded automatic worker/reviewer loops as a shortcut to finishing the prototype.
