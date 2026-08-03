// Mirrors packages/daemon/src/protocol.ts (kept local so the renderer has no
// cross-package build coupling).
export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  pid: number;
  status: 'running' | 'exited';
  exitCode?: number;
  createdAt: number;
  cols: number;
  rows: number;
  attention: boolean;
}

export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
}

export interface Subfolder {
  name: string;
  path: string;
}

declare global {
  interface Window {
    csm: {
      getDaemonInfo: () => Promise<DaemonInfo>;
      pickFolder: () => Promise<string | null>;
      listSubfolders: (root: string) => Promise<Subfolder[]>;
    };
  }
}
