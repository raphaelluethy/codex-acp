# ACP adapter for Codex

Use [Codex](https://github.com/openai/codex) from [ACP-compatible](https://agentclientprotocol.com) clients such as [Zed](https://zed.dev)!

This package is built from a fork of the upstream [Zed Codex ACP adapter](https://github.com/zed-industries/codex-acp). It tracks upstream while carrying a small patch stack that exposes selected features from the Codex CLI and Codex desktop/app experience through ACP.

Local fork additions include:

- Session controls for fast inference and approval-review routing
- Live ACP tool-call updates for Codex collaboration/sub-agent events
- Replay support for persisted collaboration tool calls
- `/goal` command exposure for long-running task goals
- Enabled Codex skills exposed as ACP slash commands

The adapter implements an ACP bridge around the Codex CLI, supporting:

- Context @-mentions
- Images
- Tool calls (with permission requests)
- Following
- Edit review
- TODO lists
- Slash commands:
  - /review (with optional instructions)
  - /review-branch
  - /review-commit
  - /init
  - /compact
  - /goal
  - /logout
  - Enabled Codex skills as slash commands
  - Custom Prompts
- Client MCP servers
- Auth Methods:
  - ChatGPT subscription (requires paid subscription and doesn't work in remote projects)
  - CODEX_API_KEY
  - OPENAI_API_KEY

Learn more about the [Agent Client Protocol](https://agentclientprotocol.com/).

## How to use

### Zed

The latest version of Zed can already use this adapter out of the box.

To use Codex, open the Agent Panel and click "New Codex Thread" from the `+` button menu in the top-right.

Read the docs on [External Agent](https://zed.dev/docs/ai/external-agents) support.

### Other clients

[Submit a PR](https://github.com/zed-industries/codex-acp/pulls) to add yours!

#### Installation

Install the adapter from the latest release for your architecture and OS: https://github.com/zed-industries/codex-acp/releases

You can then use `codex-acp` as a regular ACP agent:

```
OPENAI_API_KEY=sk-... codex-acp
```

Or via npm:

```
npx @zed-industries/codex-acp
```

#### Building from source

Build the optimized binary with:

```
cargo build --release
```

The binary is written to `target/release/codex-acp`. In the current dependency set, expect the release binary to be about 172 MB, `target/release` to be several GB, and the full `target` directory to be larger because it also includes debug and incremental build artifacts.

## License

Apache-2.0
