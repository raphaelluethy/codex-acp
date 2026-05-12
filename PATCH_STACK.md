# Local Patch Stack

This branch is intended to stay shaped as:

```text
upstream/main
  + local ACP session controls
  + local collab tool-call notifications and replay support
  + local /goal command exposure
```

The branch was reset to `upstream/main` at `156cb0d` (`Emit image generation tool calls (#271)`)
before rebuilding the local patch. The old branch tip was `478f314`.

## Historical Patches

### `a3511b1` - Update Codex dependencies to v0.124.0

Status: dropped.

This commit updated Codex crates to `rust-v0.124.0` and carried API adaptation work in
`Cargo.toml`, `Cargo.lock`, `src/codex_agent.rs`, `src/lib.rs`, `src/prompt_args.rs`, and
`src/thread.rs`.

It is not part of the rebuilt patch because upstream is already on `rust-v0.129.0`. Reapplying
this commit would downgrade dependencies and reintroduce conflicts around APIs that upstream has
since replaced.

### `cb276d6` - Session controls for speed and approval review

Status: rebuilt.

Behavior:

- Adds ACP config options for approval reviewer and service tier.
- Exposes `/fast [on|off|status]`, `/auto-review`, and `/manual-review`.
- Routes config-option changes through `Op::OverrideTurnContext`.
- Keeps local `Config` state in sync after the override is accepted.

Rebuild notes:

- The current upstream already has `Op::OverrideTurnContext` fields for `service_tier` and
  `approvals_reviewer`, so the patch now only adds ACP-facing controls.
- The rebuilt speed selector intentionally exposes only `standard` and `fast`. The old `flex`
  option was removed by the later local patch and is not restored.

### `d726109` - Live ACP tool calls for collab agent events

Status: rebuilt.

Behavior:

- Converts live collab lifecycle events into ACP tool calls:
  - `CollabAgentSpawnBegin/End` -> `spawn_agent`
  - `CollabAgentInteractionBegin/End` -> `send_input`
  - `CollabWaitingBegin/End` -> `wait`
  - `CollabCloseBegin/End` -> `close_agent`
  - `CollabResumeBegin/End` -> `resume_agent`
- Emits begin events as `ToolCall` with `InProgress`.
- Emits end events as `ToolCallUpdate` with `Completed` or `Failed`.
- Includes serialized event payloads as `raw_input`/`raw_output`.

Rebuild notes:

- Upstream now uses synchronous `SessionClient` notification helpers, so the rebuilt patch uses
  synchronous helper methods instead of the old async send path.
- The ignore-list entries for collab events are removed so handled collab events are not silently
  dropped.

### `25a81f8` - Collab replay and payload schemas

Status: rebuilt.

Behavior:

- Replays persisted collab lifecycle events as ACP tool calls.
- Adds shared status mapping for collab wait results.
- Treats empty wait-status maps as failed because there is no successful receiver result to show.
- Tests assert that collab tool calls include raw input and output payloads.

Rebuild notes:

- The current upstream already has replay support for thread-goal updates and image generation, so
  the rebuilt patch only extends replay for collab events.

### `478f314` - `/goal` command and service tier handling

Status: partially rebuilt.

Behavior kept:

- Adds `/goal` to advertised ACP slash commands.
- Leaves `/goal ...` as normal user input so Codex core handles the command.
- Documents `/goal` in both README files.

Behavior kept from the service-tier adjustment:

- ACP exposes only `standard` and `fast`.
- Any non-`fast` service tier value is displayed as `standard`, because this ACP selector only
  offers `standard` and `fast` in the current Codex dependency snapshot.

Rebuild notes:

- Upstream already includes `ThreadGoalUpdated` handling and replay, so that part of the old patch
  is not duplicated.

## Current Rebuild Scope

The rebuilt patch should touch only:

- `PATCH_STACK.md`
- `README.md`
- `npm/README.md`
- `src/thread.rs`

It should not change:

- `Cargo.toml`
- `Cargo.lock`
- CI/release scripts
- npm packaging metadata
- `src/codex_agent.rs`

Keeping the patch this narrow reduces future conflict surface. Dependency and generated lockfile
changes should come from upstream unless there is a new local behavioral requirement.

## Lower-Conflict Maintenance Workflow

Recommended branch shape:

```text
main              -> tracks upstream/main exactly
local/patch-stack -> rebased patch branch containing only local behavior
```

Recommended commands:

```sh
git fetch upstream
git switch main
git reset --hard upstream/main
git switch local/patch-stack
git rebase upstream/main
```

Recommended Git setting:

```sh
git config rerere.enabled true
```

`rerere` records conflict resolutions and can replay them on later rebases when the same conflict
shape appears again.
