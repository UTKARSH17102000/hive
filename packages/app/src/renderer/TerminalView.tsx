import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { DaemonClient } from './daemonClient';
import type { SessionInfo } from './types';

// Monokai Pro palette, matched to the app chrome.
const THEME = {
  background: '#19181a',
  foreground: '#fcfcfa',
  cursor: '#ab9df2',
  cursorAccent: '#19181a',
  selectionBackground: 'rgba(171,157,242,0.30)',
  black: '#221f22',
  red: '#ff6188',
  green: '#a9dc76',
  yellow: '#ffd866',
  blue: '#78dce8',
  magenta: '#ab9df2',
  cyan: '#78dce8',
  white: '#c1c0c0',
  brightBlack: '#727072',
  brightRed: '#ff6188',
  brightGreen: '#a9dc76',
  brightYellow: '#ffd866',
  brightBlue: '#78dce8',
  brightMagenta: '#ab9df2',
  brightCyan: '#78dce8',
  brightWhite: '#fcfcfa'
};

// One xterm per mount. Switching sessions remounts (keyed by id); the daemon replays
// scrollback on attach, so the terminal looks continuous.
export function TerminalView({ client, session }: { client: DaemonClient; session: SessionInfo }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: THEME
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const doFit = () => {
      try {
        fit.fit();
        client.resize(session.id, term.cols, term.rows);
      } catch {
        /* host not measured yet */
      }
    };
    // Give layout a tick before first fit.
    const raf = requestAnimationFrame(doFit);

    // Attach: request history + live stream at our current dimensions.
    fit.fit();
    client.attach(session.id, term.cols, term.rows);

    let firstChunk = true;
    const offData = client.on('data', (msg: { id: string; data: string }) => {
      if (msg.id === session.id) term.write(msg.data);
    });
    const offHistory = client.on('history', (msg: { id: string; data: string }) => {
      if (msg.id !== session.id) return;
      if (firstChunk && msg.data) {
        term.write(msg.data);
        firstChunk = false;
      }
    });
    const offExit = client.on('exit', (msg: { id: string; code: number }) => {
      if (msg.id === session.id) {
        term.write(`\r\n\x1b[38;5;210m● session exited (code ${msg.code})\x1b[0m\r\n`);
      }
    });

    const onInput = term.onData((data) => client.input(session.id, data));

    const ro = new ResizeObserver(() => doFit());
    ro.observe(host);

    term.focus();

    return () => {
      cancelAnimationFrame(raf);
      offData();
      offHistory();
      offExit();
      onInput.dispose();
      ro.disconnect();
      client.detach(session.id);
      term.dispose();
    };
  }, [client, session.id]);

  return <div className="xterm-host" ref={hostRef} />;
}
