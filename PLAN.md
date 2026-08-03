# Hive — Build Plan

> **Hive** — parallel Claude, one place. (formerly "Claude Session Manager")


A Windows desktop app to manage many concurrent Claude Code CLI sessions, grouped by
folder, in a modern dark UI. Sessions run inside a **persistent background daemon**, so
closing the window does **not** kill your Claude sessions — reopening the app reattaches
to them with full scrollback.

---

## 1. Core requirements (from the brief)

- Left sidebar: pick a root folder → list the folders inside it.
- For each folder: manage multiple Claude Code sessions + a `+` button to start a new one.
- Big terminal view that behaves exactly like a real terminal running `claude`.
- Closing the app must **not** close running sessions.
- Reopening the app shows all live sessions and lets you switch between them.
- Cool, new-gen **dark theme**.
- Built to iterate — easy to add features over time.

---

## 2. Why a daemon (the key design decision)

A normal desktop app spawns the terminal as a child process that dies when the app exits.
To keep Claude sessions alive across app restarts, the terminal (PTY) processes must be
owned by a **separate long-lived process** — the *daemon* — that the window merely
connects to.

```
 ┌────────────────────────────┐         WebSocket (localhost)        ┌────────────────────────┐
 │  Electron App (the window) │  ◄────────────────────────────────► │  Daemon (background)   │
 │  • React UI + xterm.js     │   input / output / resize / list     │  • owns node-pty PTYs  │
 │  • folder & session UI     │                                      │  • scrollback buffers  │
 │  can be closed & reopened  │                                      │  survives app close    │
 └────────────────────────────┘                                      └───────────┬────────────┘
                                                                                  │ spawns
                                                                       ┌──────────▼──────────┐
                                                                       │  `claude` in a PTY   │
                                                                       │  (one per session)   │
                                                                       └──────────────────────┘
```

- Daemon is spawned **detached** by the Electron main process on first launch and
  `unref()`'d, so it keeps running after the window closes.
- Daemon keeps a per-session **ring buffer** of recent output; on reconnect it replays
  history into xterm so the terminal looks continuous.
- Persistence scope: daemon lives in the user session → survives app close, stops on
  logout/reboot (chosen scope).

---

## 3. Tech stack

| Layer            | Choice                                         |
|------------------|------------------------------------------------|
| GUI framework    | Electron (+ electron-vite)                      |
| UI               | React 18 + TypeScript                           |
| Terminal render  | @xterm/xterm + @xterm/addon-fit                 |
| PTY engine       | node-pty (in the daemon, under system Node)     |
| Transport        | ws (WebSocket over localhost + token auth)      |
| Daemon build     | TypeScript → esbuild single CJS bundle          |
| Monorepo         | npm workspaces (`packages/daemon`, `packages/app`) |

node-pty lives only in the daemon (system Node), so we avoid Electron native-module
rebuilds entirely.

---

## 4. Repo layout

```
window-application/
├─ package.json                # npm workspaces + top-level scripts
├─ PLAN.md
├─ packages/
│  ├─ daemon/                  # persistent background process
│  │  ├─ src/protocol.ts       # shared message types
│  │  ├─ src/sessionManager.ts # PTY lifecycle + ring buffers
│  │  └─ src/index.ts          # WS server + lock/token file
│  └─ app/                     # electron + react window
│     ├─ electron.vite.config.ts
│     └─ src/
│        ├─ main/index.ts      # ensures daemon is running; BrowserWindow
│        ├─ preload/index.ts   # safe bridge (folder dialog, daemon info)
│        └─ renderer/          # React UI (sidebar / sessions / terminal)
```

---

## 5. Daemon protocol (WebSocket, JSON + data frames)

Client → Daemon: `list`, `create {cwd,name,cols,rows}`, `attach {id,cols,rows}`,
`input {id,data}`, `resize {id,cols,rows}`, `kill {id}`, `rename {id,name}`.

Daemon → Client: `sessions [...]`, `created {session}`, `history {id,data}`,
`data {id,data}`, `exit {id,code}`, `session-added`, `session-removed`.

Session: `{ id, name, cwd, pid, status, createdAt, cols, rows }`.

---

## 6. Iteration roadmap

- **v0.1 (done)** — daemon + persistence, folder sidebar, per-folder session list,
  `+` new session, live interactive terminal, reattach after app restart, dark theme.
- **v0.2 (done)** — flat multi-folder model (open many folders, no subfolder listing),
  collapsible folder sidebar with initials chips (Docs→D, GithubRepos→GR),
  attention notifications: a background (not-viewed) session that finishes a turn / asks a
  question pulses an animated colored border at both session and folder level (works even
  after the app was closed and reopened); close-folder / close-session controls; richer
  button + hover animations.
- **v0.2.1 (done)** — renamed to **Hive**; cyan→violet accent (pink removed); in-app
  **Stop all / shut down daemon** power control with confirm + **restart**, and a live
  **running-session count** pill in the top bar.
- **v0.3 (next)** — inline session rename, search across sessions, split/multi-terminal
  view, per-folder default launch flags, config file.
- **v0.4** — richer notifications (OS toast / taskbar flash on attention), theme options,
  packaged installer (electron-builder) so it runs like any installed app.
- **v0.5** — optional autostart daemon on login, session labels/pinning, reconnect polish.

### v0.2 visual + robustness

- **Monokai Pro theme** across the app chrome and the xterm terminal; lucide-react icon set
  (no text glyphs). Gradient pink→purple accents for primary actions and the active folder.
- **Single-instance daemon via a fixed loopback port (47615).** Binding the port is the
  guard: a second daemon hits `EADDRINUSE` and exits, so orphan daemons cannot accumulate
  even if the lock file is deleted. The app probes the port first and reuses a live daemon
  instead of spawning another. `npm run daemon:stop` remains the clean shutdown.

### v0.2 attention heuristic (how "asks a question" is detected)

The daemon flags a session for **attention** only when it is **not currently being
viewed** (focusCount 0) and either: (a) its output matches a prompt pattern
(`do you want to proceed`, `(y/n)`, numbered `❯ 1.` menus, …), or (b) it produced output
and then went silent for ~700ms (finished its turn / waiting). Focusing the session clears
it. Because the daemon owns this state, attention survives the app being closed.

---

## 7. How to run

```
npm install            # installs both workspaces
npm run build:daemon   # bundles the daemon
npm run dev            # launches the Electron window (auto-starts the daemon)
```

Closing the window leaves the daemon (and your Claude sessions) running.
`npm run daemon:stop` shuts the daemon down when you actually want everything gone.
