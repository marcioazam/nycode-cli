# Nycode

Nycode is an extensible AI agent that works from your terminal. Give it a goal and a working folder, and it can inspect files, run commands, edit content, and work through multi-step tasks.

Use Nycode for software development, research notes, writing projects, data files, or hobby work. You can use Nycode as is, prompt it to adapt itself to your workflow, or build other applications powered by Nycode using the SDK.

## Start using Nycode

New to Nycode? Follow the [Quickstart](quickstart.md) to install Nycode, connect a model, and complete your first task.

If Nycode is already installed, choose what you want to do:

- [Use Nycode interactively](usage.md) to add files, run commands, direct ongoing work, and export results.
- [Choose a model](models.md) or connect a subscription, API key, local model, or compatible endpoint.
- [Continue or branch a session](sessions.md) to resume work or explore another approach without losing history.
- [Configure Nycode](configuration.md) for your preferences, working folders, instructions, and reusable resources.
- [Understand how Nycode works](how-nycode-works.md), including tools, context, sessions, and the agent loop.

## Customize Nycode

Nycode can reuse prompts, load specialized instructions, add executable integrations, change its terminal interface, connect model services, and distribute these resources as packages.
Use the [Quickstart customization chooser](quickstart.md#choose-how-to-customize-nycode) to select the smallest mechanism that meets your need.

## Automate or embed Nycode

- Use [print mode](cli.md#invocation-and-output) for one-off and scripted tasks.
- Use [JSON event stream mode](json.md) to consume structured events from one run.
- Use [RPC mode](rpc.md) to control a separate Nycode process.
- Use the [TypeScript SDK](sdk.md) to run Nycode inside an application.

## Find reference and setup information

Use the reference pages to look up [CLI options](cli.md), [settings](settings.md), [providers](providers.md), [keybindings](keybindings.md), and [environment variables](environment-variables.md).

For platform-specific help, see [Terminal Setup](terminal-setup.md), [Windows](windows.md), [tmux](tmux.md), [Termux on Android](termux.md), or [Containerization](containerization.md).

## Work safely

Nycode's tools and extensions run with the permissions of the Nycode process. Project trust controls which project resources Nycode loads, but it does not sandbox tool calls. Review [Security](security.md) before using untrusted files, repositories, extensions, or unattended automation.
