# Proposal: public read-only provider-subagent API in the Paseo SDK

**Status:** proposal (WB-010), **deferred**: on 2026-10-21 the owner decided not to pursue an upstream Paseo PR for now. Nothing here is implemented in Workbench or Paseo. Workbench builds and works without it.

## Gap

Workbench shows provider-native children (for example Claude `Agent`/Task subagents) only from `agent.provider_subagents.update` events received while its screen is subscribed, via `paseo.observeEvents`. After a late open, a reconnect, or a daemon restart the tree is incomplete, and the UI says so ("Live-only").

Paseo 0.12 already has everything needed below the public surface:

| Layer | Exists in 0.12.0 |
|---|---|
| Protocol | `agent.provider_subagents.list.request/response`, `agent.provider_subagents.timeline.get.request/response`, `agent.provider_subagents.update` (`upsert` / `timeline` / `remove`) |
| `DaemonClient` (`@getpaseo/client/internal/daemon-client`) | `listProviderSubagents(parentAgentId)`, `fetchProviderSubagentTimeline(parentAgentId, subagentId, options)` |
| Public `PaseoApi` (what plugins get from `usePaseo` / `getPaseoClient`) | **missing**: only `observeEvents([...])`, live events only |

Plugins must not import `internal/*`, so the gap is exactly one public wrapper.

## Proposed API (smallest change)

Add a read-only namespace to `PaseoApi` in `packages/client/src/index.ts`:

```ts
export interface PaseoProviderSubagentActions {
  /** Current native children of a managed agent, including finished ones the provider still reports. */
  list(parentAgentId: string, options?: { requestId?: string }): Promise<{
    parentAgentId: string;
    subagents: PaseoProviderSubagent[];   // same shape as the existing list.response payload
    error: string | null;                 // provider without support reports here, not by throwing
  }>;
  /** One page of a native child's timeline. Read-only. */
  timeline(parentAgentId: string, subagentId: string, options?: {
    direction?: "tail" | "before"; cursor?: string; limit?: number; requestId?: string;
  }): Promise<ProviderSubagentTimelinePayload>;
}

export interface PaseoApi {
  // ...existing members
  readonly providerSubagents: PaseoProviderSubagentActions;
}
```

Plus one navigation affordance for plugin surfaces, next to `openAgent`:

```ts
navigation.openProviderSubagent?: (input: { serverId?: string; parentAgentId: string; subagentId: string }) => void;
```

It opens the existing built-in read-only provider-subagent viewer. It is optional, so older hosts leave it undefined and plugins hide the button.

**Explicitly out of scope:** sending input to native children, cancelling them, new provider events, or any server-runtime change. Native children stay read-only and distinct from managed agents (no ID conflation).

## Requirements for the upstream PR

- Same read authorization as fetching the parent agent's timeline.
- Capability detection: hosts advertise support (for example `server_info.features.providerSubagentList`); the wrapper rejects with a typed "unsupported" error on older hosts.
- Subscriptions created through the plugin's borrowed client are released with the plugin (existing owned-subscription rules).
- Tests: late subscriber gets full list; nested child via `parentSubagentId`; canceled child; daemon restart; provider without native-subagent support returns `error`, not an empty list.
- Separate PR from Workbench; no Workbench code in Paseo.

## Workbench change after agreement (about 30 lines)

1. On Activity open and on each host reconnect, call `paseo.providerSubagents.list(agentId)` for running or recently updated managed agents, then merge live `upsert`/`remove` events through the existing `applyNativeUpdate` (client/directory.ts).
2. Replace the "Live-only" notice with "Complete as of <time>" only when every listed parent's `list` succeeded; keep the notice for hosts without the capability.
3. Show "Open" on native rows when `navigation.openProviderSubagent` exists.

## If upstream declines

Keep the current live-only view (honest, already shipped). A fork that only re-exports the wrapper is possible but would force a custom mobile build, so it is not recommended.
