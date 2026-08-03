# Hive

*parallel Claude, one place.*

A Windows desktop app to manage many concurrent **Claude Code** CLI sessions, grouped by
folder, in a modern Monokai-Pro dark UI. Sessions run inside a **persistent background daemon**, so
closing the window does **not** kill your Claude sessions — reopening reattaches to them
with full scrollback.

> See [PLAN.md](./PLAN.md) for the full architecture and roadmap.

## Layout

- `packages/daemon` — long-lived background process that owns every Claude PTY (node-pty),
  keeps a scrollback buffer per session, and serves a token-authed WebSocket on localhost.
  Spawned **detached** so it outlives the window.
- `packages/app` — Electron + React window (sidebar → folders → sessions → live terminal).

## Prerequisites

- **Windows** + **Node.js 20+** on your PATH (the daemon runs under system Node — this is
  required by both the installed app and dev mode).
- The `claude` CLI on your PATH (Hive launches `claude` in each session).

## Install as a real app (recommended)

Build a Windows installer and run Hive like any other program — searchable in the Start
menu and with a desktop icon. No `npm run dev` needed afterwards.

```powershell
npm install
npm run dist        # builds everything, then produces the installer
```

The installer lands at **`release/Hive-Setup-<version>.exe`**. Run it, then launch Hive
from the **Start menu** (search "Hive") or the **desktop shortcut**.

## Run from source (dev)

```powershell
npm install          # installs both workspaces (builds node-pty)
npm run dev          # builds the daemon, then launches the window
```

### Using it

1. **Open a folder** (sidebar) — open as many as you like; each is independent. Collapse
   the sidebar to initials chips.
2. Select a folder, hit **+** to launch a Claude session in it.
3. The panel on the right is a real interactive `claude` terminal. Use the **split** icon
   on a session to view several at once, or **Ctrl+K** to jump between any session.
4. Double-click a session name to rename it. The **power** button (top-right) stops all
   sessions and shuts the daemon down.
5. Close the window whenever — sessions keep running. Reopen and they're all still there,
   including which one was asking for your attention.

### Stopping everything

Closing the window leaves the daemon (and sessions) running. Use the in-app **power**
button, or from source:

```powershell
npm run daemon:stop
```

## Handy scripts

| Command                    | What it does                                  |
|----------------------------|-----------------------------------------------|
| `npm run dist`             | Build everything + produce the Windows installer |
| `npm run dev`              | Build daemon + launch the app (dev)           |
| `npm run build:daemon`     | Rebuild just the daemon bundle                |
| `npm run build`            | Production build of daemon + app              |
| `npm run daemon:stop`      | Kill the background daemon                     |
| `node scripts/smoke.mjs`   | End-to-end test against a running daemon       |

## State

Daemon lock/token lives at `~/.claude-session-manager/daemon.json`. The chosen root
folder is remembered in the app's localStorage.
