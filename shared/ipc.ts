export type AppInfo = {
  appVersion: string;
  platform: NodeJS.Platform;
  dbPath: string;
  imageCount: number;
};

export interface ZenithApi {
  getAppInfo(): Promise<AppInfo>;
}

declare global {
  interface Window {
    zenith: ZenithApi;
  }
}
