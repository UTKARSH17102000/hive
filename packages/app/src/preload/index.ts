import { contextBridge, ipcRenderer } from 'electron';

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

const api = {
  getDaemonInfo: (): Promise<DaemonInfo> => ipcRenderer.invoke('daemon:info'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  listSubfolders: (root: string): Promise<Subfolder[]> =>
    ipcRenderer.invoke('fs:subfolders', root)
};

contextBridge.exposeInMainWorld('csm', api);

export type CsmApi = typeof api;
