export interface Cookie {
  name: string;
  value: string;
  domain: string;
}

export interface CookieJar {
  sessionKey: string;
  orgId: string;
}

export interface ChromeOptions {
  port?: number;
  profileDir?: string;
}
