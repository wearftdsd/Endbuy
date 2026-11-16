/** Pont vers l'application de bureau Electron (exposé par le preload). Absent dans un navigateur. */
export interface ScreenSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string | null;
  isScreen: boolean;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  getConfig(): Promise<{ mode: 'local' | 'remote'; serverUrl: string; lanHosting: boolean; lanUrls: string[]; localUrl: string | null }>;
  setServer(cfg: { mode: 'local' | 'remote'; serverUrl?: string; lanHosting?: boolean }): Promise<void>;
  getScreenSources(): Promise<ScreenSource[]>;
  selectScreenSource(id: string, withAudio: boolean): Promise<void>;
  setBadge(count: number): void;
  flashFrame(): void;
  notify(title: string, body: string): void;
  openExternal(url: string): void;
}

export const desktop: DesktopBridge | undefined = (window as any).endbuyDesktop;
export const isDesktop = !!desktop;
