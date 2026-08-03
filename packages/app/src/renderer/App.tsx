import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Hexagon,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  X,
  SquareTerminal,
  BellRing,
  TriangleAlert,
  Power,
  Play,
  Search,
  SplitSquareHorizontal
} from 'lucide-react';
import { DaemonClient } from './daemonClient';
import { TerminalView } from './TerminalView';
import { QuickSwitch, type QItem } from './QuickSwitch';
import type { SessionInfo } from './types';

const FOLDERS_KEY = 'csm.openFolders';
const COLLAPSED_KEY = 'csm.foldersCollapsed';
const PANES_KEY = 'csm.panes';
const MAX_PANES = 4;

export default function App() {
  const clientRef = useRef<DaemonClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openFolders, setOpenFolders] = useState<string[]>(() => loadFolders());
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(COLLAPSED_KEY) !== 'false'
  );
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [panes, setPanes] = useState<string[]>(() => loadPanes());
  const [stopped, setStopped] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);

  // ---- daemon connection ----
  useEffect(() => {
    const client = new DaemonClient();
    clientRef.current = client;

    const offs = [
      client.on('status', (s: string) => setConnected(s === 'connected')),
      client.on('sessions', (m: { sessions: SessionInfo[] }) => setSessions(m.sessions)),
      client.on('session-added', (m: { session: SessionInfo }) =>
        setSessions((prev) => upsert(prev, m.session))
      ),
      client.on('created', (m: { session: SessionInfo }) => {
        setSessions((prev) => upsert(prev, m.session));
        setPanes([m.session.id]);
      }),
      client.on('session-removed', (m: { id: string }) =>
        setSessions((prev) => prev.filter((s) => s.id !== m.id))
      ),
      client.on('renamed', (m: { id: string; name: string }) =>
        setSessions((prev) => prev.map((s) => (s.id === m.id ? { ...s, name: m.name } : s)))
      ),
      client.on('exit', (m: { id: string; code: number }) =>
        setSessions((prev) =>
          prev.map((s) => (s.id === m.id ? { ...s, status: 'exited', exitCode: m.code } : s))
        )
      ),
      client.on('activity', (m: { id: string; attention: boolean }) =>
        setSessions((prev) =>
          prev.map((s) => (s.id === m.id ? { ...s, attention: m.attention } : s))
        )
      ),
      client.on('error', (m: { message: string }) => setError(m.message))
    ];

    client.connect();
    return () => offs.forEach((off) => off());
  }, []);

  // ⌘K / Ctrl+K opens the cross-session quick switcher. Use the CAPTURE phase and stop
  // propagation so xterm (which has keyboard focus while you type in a terminal) never
  // swallows the shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setQuickOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Union of explicitly opened folders and any folder that still has sessions.
  const folders = useMemo(() => {
    const paths = new Set(openFolders);
    for (const s of sessions) paths.add(s.cwd);
    return [...paths].map((p) => ({ path: p, name: basename(p), initials: initials(basename(p)) }));
  }, [openFolders, sessions]);

  useEffect(() => {
    if (folders.length === 0) return setSelectedFolder(null);
    if (!selectedFolder || !folders.some((f) => samePath(f.path, selectedFolder))) {
      setSelectedFolder(folders[0].path);
    }
  }, [folders, selectedFolder]);

  // Keep panes pointing only at sessions that still exist; persist them.
  useEffect(() => {
    setPanes((prev) => {
      const valid = prev.filter((id) => sessions.some((s) => s.id === id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [sessions]);
  useEffect(() => localStorage.setItem(PANES_KEY, JSON.stringify(panes)), [panes]);

  const folderSessions = useMemo(
    () => sessions.filter((s) => selectedFolder && samePath(s.cwd, selectedFolder)),
    [sessions, selectedFolder]
  );
  const paneSessions = useMemo(
    () => panes.map((id) => sessions.find((s) => s.id === id)).filter(Boolean) as SessionInfo[],
    [panes, sessions]
  );

  const sessionCount = (p: string) => sessions.filter((s) => samePath(s.cwd, p)).length;
  const folderAttention = (p: string) => sessions.some((s) => samePath(s.cwd, p) && s.attention);
  const runningCount = sessions.filter((s) => s.status === 'running').length;

  // ---- actions ----
  async function openFolder() {
    const picked = await window.csm.pickFolder();
    if (!picked) return;
    setOpenFolders((prev) => {
      const next = prev.some((p) => samePath(p, picked)) ? prev : [...prev, picked];
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
      return next;
    });
    setSelectedFolder(picked);
  }

  function closeFolder(path: string) {
    setOpenFolders((prev) => {
      const next = prev.filter((p) => !samePath(p, path));
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(next));
      return next;
    });
  }

  function toggleCollapsed() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, String(!c));
      return !c;
    });
  }

  function newSession() {
    if (!selectedFolder || !clientRef.current) return;
    setError(null);
    clientRef.current.create(selectedFolder, 80, 24);
  }

  function killSession(id: string) {
    clientRef.current?.kill(id);
    setPanes((p) => p.filter((x) => x !== id));
  }

  // Terminal panes -----------------------------------------------------------
  const openSingle = (id: string) => setPanes([id]);
  const addPane = (id: string) =>
    setPanes((p) => (p.includes(id) ? p : [...p, id].slice(0, MAX_PANES)));
  const closePane = (id: string) => setPanes((p) => p.filter((x) => x !== id));

  // Inline rename ------------------------------------------------------------
  function startRename(s: SessionInfo) {
    setEditingId(s.id);
    setEditValue(s.name);
  }
  function commitRename() {
    if (editingId && editValue.trim()) clientRef.current?.rename(editingId, editValue.trim());
    setEditingId(null);
  }

  // Quick switch -------------------------------------------------------------
  const quickItems: QItem[] = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        name: s.name,
        folder: basename(s.cwd),
        cwd: s.cwd,
        status: s.status,
        attention: s.attention
      })),
    [sessions]
  );
  function quickPick(id: string) {
    const s = sessions.find((x) => x.id === id);
    if (s) {
      setSelectedFolder(s.cwd);
      openSingle(id);
    }
    setQuickOpen(false);
  }

  function shutdownDaemon() {
    const msg =
      runningCount > 0
        ? `Stop all ${runningCount} running session${runningCount > 1 ? 's' : ''} and shut down the background daemon?\n\nThis ends every Claude session — they will NOT survive.`
        : 'Shut down the background daemon?';
    if (!window.confirm(msg)) return;
    clientRef.current?.shutdown();
    setStopped(true);
    setSessions([]);
    setPanes([]);
  }

  function restartDaemon() {
    setStopped(false);
    clientRef.current?.restart();
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="logo">
            <Hexagon size={16} strokeWidth={2.25} />
          </span>
          Hive
          <span className="brand-sub">parallel Claude, one place</span>
        </div>
        <div className="spacer" />

        {stopped ? (
          <>
            <div className="status-pill">
              <span className="dot off" />
              daemon stopped
            </div>
            <button className="btn sm" title="Start the daemon again" onClick={restartDaemon}>
              <Play size={14} /> Start
            </button>
          </>
        ) : (
          <>
            <button
              className="search-trigger"
              title="Search sessions (Ctrl+K)"
              onClick={() => setQuickOpen(true)}
            >
              <Search size={14} /> Search
              <kbd>Ctrl K</kbd>
            </button>
            {runningCount > 0 && (
              <div className="run-pill" title={`${runningCount} running session(s)`}>
                <span className="run-dot" />
                {runningCount} running
              </div>
            )}
            <div className="status-pill">
              <span className={`dot ${connected ? 'on' : 'off'}`} />
              {connected ? 'connected' : 'connecting…'}
              <span className="muted-inline">· {sessions.length} total</span>
            </div>
            <button
              className="iconbtn ghost danger"
              title="Stop all sessions & shut down the daemon"
              onClick={shutdownDaemon}
              disabled={!connected}
            >
              <Power size={16} />
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="error-banner">
          <TriangleAlert size={15} />
          <span className="label">{error}</span>
          <button className="iconbtn ghost sm" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="main" style={{ gridTemplateColumns: `${collapsed ? 72 : 258}px 268px 1fr` }}>
        {/* ---- folders ---- */}
        {collapsed ? (
          <div className="col rail">
            <button className="iconbtn ghost" title="Expand sidebar" onClick={toggleCollapsed}>
              <PanelLeftOpen size={18} />
            </button>
            <div className="rail-list">
              {folders.map((f) => (
                <button
                  key={f.path}
                  className={`chip ${selectedFolder && samePath(selectedFolder, f.path) ? 'active' : ''} ${
                    folderAttention(f.path) ? 'alert' : ''
                  }`}
                  title={f.path}
                  onClick={() => setSelectedFolder(f.path)}
                >
                  {f.initials}
                  {sessionCount(f.path) > 0 && (
                    <span className="chip-count">{sessionCount(f.path)}</span>
                  )}
                  <span
                    className="chip-remove"
                    title="Remove folder"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeFolder(f.path);
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              ))}
            </div>
            <button className="iconbtn grad" title="Open a folder" onClick={openFolder}>
              <FolderPlus size={18} />
            </button>
          </div>
        ) : (
          <div className="col">
            <div className="col-head">
              <span className="col-title">Folders</span>
              <div className="col-actions">
                <button className="iconbtn ghost sm" title="Open a folder" onClick={openFolder}>
                  <FolderPlus size={16} />
                </button>
                <button className="iconbtn ghost sm" title="Collapse sidebar" onClick={toggleCollapsed}>
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>
            <div className="col-body">
              {folders.length === 0 ? (
                <>
                  <button className="btn" onClick={openFolder}>
                    <FolderPlus size={16} /> Open a folder
                  </button>
                  <div className="hint">Open one or more folders to work in — each is independent.</div>
                </>
              ) : (
                folders.map((f) => (
                  <div
                    key={f.path}
                    className={`row folder-row ${
                      selectedFolder && samePath(selectedFolder, f.path) ? 'active' : ''
                    } ${folderAttention(f.path) ? 'alert' : ''}`}
                    onClick={() => setSelectedFolder(f.path)}
                  >
                    <span className="folder-badge">{f.initials}</span>
                    <div className="folder-meta">
                      <span className="label" title={f.name}>
                        {f.name}
                      </span>
                      <span className="sub" title={f.path}>
                        {f.path}
                      </span>
                    </div>
                    {folderAttention(f.path) && (
                      <span className="bell" title="A session here wants you">
                        <BellRing size={15} />
                      </span>
                    )}
                    {sessionCount(f.path) > 0 && <span className="count">{sessionCount(f.path)}</span>}
                    <button
                      className="row-action"
                      title="Remove folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeFolder(f.path);
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ---- sessions ---- */}
        <div className="col">
          <div className="col-head">
            <span className="col-title">Sessions</span>
            <button
              className="iconbtn grad sm"
              title="New Claude session in this folder"
              disabled={!selectedFolder}
              onClick={newSession}
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
          </div>
          <div className="col-body">
            {!selectedFolder ? (
              <div className="hint">Open and select a folder to see its sessions.</div>
            ) : folderSessions.length === 0 ? (
              <div className="hint">
                No sessions here yet — hit the <b>+</b> above to launch Claude in this folder.
              </div>
            ) : (
              folderSessions.map((s) => (
                <div
                  key={s.id}
                  className={`row session-row ${panes.includes(s.id) ? 'active' : ''} ${
                    s.attention ? 'alert' : ''
                  }`}
                  onClick={() => editingId !== s.id && openSingle(s.id)}
                >
                  <div className="line1">
                    <span className="s-icon">
                      <SquareTerminal size={16} />
                    </span>
                    {editingId === s.id ? (
                      <input
                        className="rename-input"
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          else if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                    ) : (
                      <span
                        className="label"
                        title="Double-click to rename"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startRename(s);
                        }}
                      >
                        {s.name}
                      </span>
                    )}
                    {s.attention && (
                      <span className="bell" title="Waiting for you">
                        <BellRing size={15} />
                      </span>
                    )}
                    <button
                      className="row-action"
                      title="Open in split view"
                      onClick={(e) => {
                        e.stopPropagation();
                        addPane(s.id);
                      }}
                    >
                      <SplitSquareHorizontal size={15} />
                    </button>
                    <button
                      className="row-action danger-action"
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation();
                        killSession(s.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="line2">
                    <span className={`badge ${s.status}`}>
                      <span className="bdot" />
                      {s.status}
                    </span>
                    <span>pid {s.pid}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ---- terminal(s) ---- */}
        <div className="col term-col">
          {paneSessions.length > 0 && clientRef.current ? (
            <div className={`pane-grid count-${paneSessions.length}`}>
              {paneSessions.map((s) => (
                <div className="pane" key={s.id}>
                  <div className="pane-head">
                    <span className="term-title">
                      <span className="t-icon">
                        <SquareTerminal size={16} />
                      </span>
                      {s.name}
                    </span>
                    <span className="term-cwd" title={s.cwd}>
                      {basename(s.cwd)}
                    </span>
                    <div className="spacer" />
                    <span className={`badge ${s.status}`}>
                      <span className="bdot" />
                      {s.status}
                    </span>
                    {paneSessions.length > 1 && (
                      <button
                        className="iconbtn ghost sm"
                        title="Close this pane"
                        onClick={() => closePane(s.id)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div className="pane-body">
                    <TerminalView key={s.id} client={clientRef.current!} session={s} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="e-badge">
                <SquareTerminal size={28} strokeWidth={2} />
              </div>
              <div className="big">No session selected</div>
              <div className="muted">
                Open a folder, then start a Claude session with <b>+</b>. Use the <b>split</b> icon
                on a session to view several at once, or <kbd>Ctrl K</kbd> to jump between them.
              </div>
            </div>
          )}
        </div>
      </div>

      {quickOpen && (
        <QuickSwitch items={quickItems} onPick={quickPick} onClose={() => setQuickOpen(false)} />
      )}
    </div>
  );
}

// ---- helpers ----
function loadFolders(): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function loadPanes(): string[] {
  try {
    const raw = localStorage.getItem(PANES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function upsert(list: SessionInfo[], s: SessionInfo): SessionInfo[] {
  return list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s];
}
function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}
// "Docs" -> "D", "GithubRepos" -> "GR", "my-cool-app" -> "MCA" (max 3 chars).
function initials(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join('');
}
