# Quickstart

Nycode runs in your terminal and works with files on your machine. To use it, you need access to a model through a supported provider. This can be a subscription, an API key, or a local model.

For native Windows setup, read [Windows Setup](windows.md). For Android, read [Termux Setup](termux.md).

## 1. Install Nycode

Download the archive for your platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`, `windows-arm64`) from <https://github.com/marcioazam/nycode/releases>. The binary is self-contained: it needs no Node.js and no `npm install`. Nycode is not published to npm. The first release is `2.0.0`.

Check the download against `SHA256SUMS` from the same release and unpack it (Linux x64 shown; Windows ships `nycode-<platform>.zip`):

```bash
sha256sum -c --ignore-missing SHA256SUMS
tar -xzf nycode-linux-x64.tar.gz
```

To verify the build provenance, run `gh attestation verify nycode-linux-x64.tar.gz -R marcioazam/nycode` (GitHub CLI 2.49 or newer). Put the unpacked `nycode` directory on your `PATH`.

To work from sources instead, see [Getting started](../../../README.md#getting-started) in the repository README.

Verify the installation:

```bash
nycode --version
```

## 2. Start Nycode

Change to the folder you want Nycode to work with, then start it:

```bash
cd /path/to/folder
nycode
```

The working folder helps Nycode discover relevant files, instructions, and configuration. Nycode also uses it to group saved sessions.

<p align="center"><img src="images/interactive-mode.png" alt="Nycode running in a terminal with a conversation, input editor, and status footer" width="750"></p>

The interface shows your conversation, an editor for prompts and commands, and a footer with the current folder, model, and session status. See [Use Nycode in the terminal](usage.md) to learn how to add files, run commands, direct ongoing work, and manage results.

## 3. Choose a model

A **model** generates Nycode's responses. A **provider** is the service or account Nycode uses to access that model.

In Nycode, run:

```text
/login
```

Choose a provider, then follow the prompts to use a subscription or store an API key. Run `/model` afterward if you want to select a different available model.

See [Choose a model and provider](models.md) for supported providers, environment-variable authentication, local models, and custom endpoints.

## 4. Give Nycode a task

Nycode shows each file read, search, command, and edit it performs. It does not ask before every tool call.

Enter a task that matches your work, for example:

```text
Summarize @meeting-notes.md and save the action items to action-items.md.
```

```text
Explain how this repository is structured and how to run its checks.
```

```text
Compare @previous.csv with @current.csv and summarize the important changes.
```

Type `@` in the editor to search for a file instead of entering its full path. When Nycode finishes, review its response and any changed files. Use version control or backups for important work. For untrusted or unattended work, use a container or another sandbox. See [Security](security.md).

## Continue later

Nycode saves sessions automatically. Exit Nycode, then resume the most recent session for the same working folder with:

```bash
nycode --continue
```

Use `/resume` to choose another saved session. See [Continue or branch a session](sessions.md) for session naming, branching, compaction, export, and sharing.

## Next steps

- [Use Nycode interactively](usage.md) to learn input, commands, shortcuts, and queued messages.
- [Add instructions](configuration.md#context-files) that Nycode should follow whenever it works in a folder.
- [Choose a model and provider](models.md).

### Choose how to customize Nycode

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Give Nycode persistent instructions for a folder | [`AGENTS.md`](configuration.md#context-files) |
| Reuse a prompt from the `/` menu | [Prompt template](prompt-templates.md) |
| Add task-specific instructions and supporting files | [Skill](skills.md) |
| Add executable tools, commands, or event handlers | [Extension](extensions.md) |
| Build a custom terminal component | [Terminal UI](tui.md) |
| Connect an unsupported model service | [Custom provider](custom-provider.md) |
| Install or distribute several resources | [Nycode package](packages.md) |

## Uninstall Nycode

If you installed from a release download, delete the unpacked `nycode` directory and the archive.

Uninstalling does not remove configuration, credentials, sessions, or installed Nycode packages from `~/.nycode/agent/`.
