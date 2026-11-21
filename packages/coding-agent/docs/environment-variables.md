# Environment Variables

Nycode uses environment variables in three ways:

- Variables such as `NYCODE_OFFLINE` configure the Nycode process.
- Nycode sets process markers so child processes can identify Nycode as the launching agent.
- Commands run by the LLM-callable shell tools receive `PI_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#use-an-api-key-from-the-environment).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=nycode` is a generic marker that lets tooling identify Nycode as the agent that launched the process.
- `NYCODE_CODING_AGENT=true` is Nycode-specific and lets child processes detect that they run inside Nycode.

Child processes inherit both markers. They are not session-specific and are not set automatically when Nycode is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current Nycode session state:

| Variable | Description |
|----------|-------------|
| `NYCODE_SESSION_ID` | Current session ID |
| `NYCODE_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `NYCODE_PROVIDER` | Currently selected model provider |
| `NYCODE_MODEL` | Currently selected model ID |
| `NYCODE_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting Nycode. `NYCODE_PROVIDER` and `NYCODE_MODEL` identify the selected Nycode model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$NYCODE_PROVIDER" "$NYCODE_MODEL"
printf 'reasoning=%s session=%s\n' "$NYCODE_REASONING_LEVEL" "$NYCODE_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$NYCODE_SESSION_FILE" ]; then
  tail -n 1 "$NYCODE_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with Nycode. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Nycode removes inherited values for these variables so nested Nycode processes do not expose stale parent-session metadata.

## Nycode Process Configuration

These variables are read by Nycode itself:

| Variable | Description |
|----------|-------------|
| `NYCODE_CODING_AGENT_DIR` | Override the config directory; default is `~/.nycode/agent` |
| `NYCODE_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `NYCODE_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `NYCODE_OFFLINE` | Disable automatic network activity, including model catalog refreshes |
| `NYCODE_SKIP_VERSION_CHECK` | Disable the GitHub Releases latest-version request |
| `NYCODE_SELF_UPDATE_COMMAND` | Command `nycode update` runs to update Nycode itself, split on whitespace, with `{packageName}`, `{version}`, and `{installSpec}` placeholders. Takes precedence over the `selfUpdateCommand` setting. See [Custom update command](cli.md#custom-update-command) |
| `NYCODE_TELEMETRY` | Override provider attribution headers (there is no install report): `1`/`true`/`yes` or `0`/`false`/`no` |
| `NYCODE_CODEMODE_MAX_WORKERS` | Maximum codemode workers alive at once across all sessions in the process; default `2`. Each worker's script may use up to 256 MB. Raise it when one process runs several sessions, such as in-process subagents. Further scripts wait for a free worker. See [Codemode](codemode.md) |
| `NYCODE_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `NYCODE_MODEL_CATALOG_URL` | Base URL of a model catalog server (`/api/models/providers/<provider>`). Unset by default: nycode uses only the bundled model data and requests no remote catalog |
| `NYCODE_SHARE_VIEWER_URL` | Viewer base URL for `/share`; unset by default, so `/share` returns only the gist link |
| `NYCODE_RADIUS_GATEWAY` | Origin of the Radius gateway. There is no default gateway: without it the built-in `radius` provider does not exist and `/bug` offers only the zip export. Custom gateways can also be configured in `models.json` |
| `NYCODE_CLEAR_ON_SHRINK` | Set to `1` to clear empty rows when rendered content shrinks; the `terminal.clearOnShrink` setting takes precedence. See [Settings](settings.md) |
| `NYCODE_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `NYCODE_CLIPBOARD_OSC52` | Set to `1` to also send copied text to the terminal with OSC 52 after the local clipboard write, as Nycode does over SSH. Use it when a remote client reaches Nycode without SSH variables, such as a multiplexer attached from another machine or a remote IDE daemon |
| `NYCODE_HYPERLINKS` | Override OSC 8 hyperlink detection with `1`, `0`, or `auto` |
| `NYCODE_PROGRAM_STATUS` | Override OSC 7501 program status detection: `1` always reports, `0` never reports; otherwise Nycode reports only after the terminal confirms support. See [Terminal setup](terminal-setup.md#program-status) |
| `NYCODE_IMAGE_PROTOCOL` | Override inline image detection with `kitty`, `iterm2`, `none`, or `auto` |
| `NYCODE_TRUE_COLOR` | Override truecolor detection with `1`, `0`, or `auto` |
| `NYCODE_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

### Nycode Settings Variables

Every variable below overrides the `settings.json` key in the second column; the variable wins over the file. Switches accept `1`/`true` and `0`/`false`. A value that does not parse is ignored and the file value applies. Defaults are in [Settings](settings.md#permissions-harness-and-integrations). The extensions that use these keys are built in; the variables exist so automation can override a file.

| Variable | Setting |
|----------|---------|
| `NYCODE_BYPASS_PERMISSIONS` | `permissions.bypass`; `--bypass`, `--dangerously-skip-permissions`, `--safe`, and `--no-bypass` take precedence |
| `NYCODE_COMPACT_AT` | `compaction.maxContextTokens` |
| `NYCODE_EFFORT_SANDWICH`, `NYCODE_EFFORT_SANDWICH_TURNS` | `harness.effortSandwich.enabled`, `harness.effortSandwich.turns` |
| `NYCODE_SUBAGENT_RESPAWN` | `subagent.respawn` |
| `NYCODE_HEADLESS_LEAN`, `NYCODE_HEADLESS_TRIM`, `NYCODE_HEADLESS_TOOLS`, `NYCODE_HEADLESS_FLOOR` | `harness.headless.lean`, `.trim`, `.tools`, `.floor` |
| `NYCODE_BASH_TIMEOUT_BG` | `tools.bash.backgroundOnTimeout` |
| `NYCODE_TODO_SYNC` | `todo.staleReminder` |
| `NYCODE_PREFIX_CACHE_1H` | `harness.prefixCache1h` |
| `NYCODE_AUTO_RESUME` | `harness.autoResume` |
| `NYCODE_PLAN_GATE` | `plan.gate` |
| `NYCODE_COMPLETION_GATE` | `harness.completionGate` |
| `NYCODE_SOUND_NOTIFY` | `notify.sound` |
| `NYCODE_UI_STATE`, `NYCODE_REDUCED_MOTION`, `NYCODE_NERD_FONT`, `NYCODE_ASCII_ICONS` | `terminal.uiState`, `.reducedMotion`, `.nerdFont`, `.asciiIcons` |
| `NYCODE_KNOWLEDGE_VAULT`, `NYCODE_GRAPHS_VAULT` | `knowledge.vault`, `knowledge.graphsVault` |
| `CODEGRAPH_AUTO_ROOT`, `CODEGRAPH_BIN`, `CODEGRAPH_STATUS_TTL`, `CODEGRAPH_AUTO_STATE` | `codegraph.autoRoot`, `.bin`, `.statusTtl`, `.autoState` (the codegraph tool's own names) |
| `NYCODE_MCP_CONFIG` | `mcp.configPath` |

`NYCODE_DISABLE_TERMINAL_TITLE`, `NYCODE_SUBAGENT`, and `NYCODE_SUBAGENT_DEPTH` have no settings key: the first is a switch for automation and the other two mark child processes.

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and provider-specific configuration are listed in [Providers](providers.md#use-an-api-key-from-the-environment).
