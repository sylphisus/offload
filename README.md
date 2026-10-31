# offload

Your agents ask you one-line questions with two answers. You keep your fingers on
the keyboard and answer each one with a single keypress.

Agents spend most of their time waiting on small decisions: this approach or that one,
commit or hold, allow this command or not. offload puts those decisions in a queue beside
the chat, one at a time, so you can get through them quickly.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install offload --marketplace sylphisus/offload
```

Answer `y` to add the marketplace, then pick a scope (user scope installs it everywhere).

From a shell:

```bash
claude plugin install offload --marketplace sylphisus/offload
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `sylphisus/offload`, then **Add plugin**.

Needs Node 18 or later. There's nothing else to install.

## What you get

- **The offload pane.** It opens beside the chat (or run `/offload` to open it). Click it
  once, then answer with the keys below.
- **An `ask` tool for agents.** Agents call it for decisions they'd otherwise ask about in a
  paragraph. Its instructions keep each question to one line with two short options, with
  the recommended option first.
- **Permission prompts in the pane.** While the pane is open, "allow this command?" prompts
  come to it as allow / deny / rethink. Close the pane and Claude Code goes back to its
  usual dialog.

## Keys

| Left hand | Right hand | Action |
| --- | --- | --- |
| Z | , | first option (the agent's recommendation) |
| X | . | second option |
| C | / | neither: the agent rewords the question and asks again, at the back of the queue |

On a permission prompt, the third key means "rethink". The command is denied, and the
agent is told to try a different approach instead of retrying it.

A new question ignores keys for its first 250 ms, so you can't answer one you haven't
seen. If you answer within 10 s, your combo goes up.

## How it works

A small local server (`server/server.js`, port 7777) holds one queue for every agent
session on your machine. The pane starts it when needed. So does the `ask` tool.

There's also a browser version of the console at http://localhost:7777 for a second
monitor. It reads the same queue, and you can use it alongside the pane or instead of it.
To try it without an agent, run `node server/demo.js`.

### Settings

- `OFFLOAD_PORT`: the server's port (default 7777). The pane always uses 7777.
- `OFFLOAD_NO_OPEN=1`: stops the `ask` tool from opening the browser console when no
  console is open.
- If long-waiting `ask` calls time out, raise Claude Code's `MCP_TOOL_TIMEOUT` (ms).

## License

MIT
