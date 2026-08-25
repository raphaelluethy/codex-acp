# Slash commands

The adapter publishes built-in commands and enabled Codex skills to ACP clients as available commands. Each command is identified without changing its human-readable description by `_meta.codex.commandKind`, which is either `builtin` or `skill`.

| Command | Behavior |
| --- | --- |
| `/plan` | Toggle Plan mode for the session. |
| `/status` | Display the current model, directory, approval and sandbox settings, account, token usage, and limits. |
| `/mcp` | List configured MCP servers and their available tools and resources. |
| `/skills` | List configured Codex skills. |
| `/fast`, `/fast on`, `/fast off`, `/fast status` | Toggle Fast mode, set it explicitly, or show its current state. Fast inference is used only when the selected model supports it. |
| `/auto-review` | Select the `agent` mode and route approval requests through auto review. |
| `/manual-review` | Select the `read-only` mode and route approval requests to the user. |
| `/goal <objective>`, `/goal clear`, `/goal pause`, `/goal resume` | Create, replace, clear, pause, or resume the session goal. |
| `/review [instructions]` | Review uncommitted changes, optionally with custom instructions. |
| `/review-branch <branch>` | Review changes relative to a base branch. |
| `/review-commit <sha>` | Review a specific commit. |
| `/compact` | Summarize the conversation to reduce context usage. |
| `/logout` | Sign out of the current ChatGPT-backed Codex account. |
| `/<skill> [instructions]` | Invoke an enabled Codex skill with structured skill input while preserving prompt attachments and resources. |
