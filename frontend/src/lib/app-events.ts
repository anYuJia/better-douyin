export const COOKIE_INVALID_EVENT = "dy-cookie-invalid";
export const COOKIE_LOGIN_STATUS_EVENT = "cookie-login-status";
export const ACCOUNTS_CHANGED_EVENT = "dy-accounts-changed";

export type CookieInvalidDetail = {
  message?: string;
};

export type CookieLoginStatusDetail = {
  event?: string;
  message?: string;
  cookie_set?: boolean;
  sec_uid?: string;
  nickname?: string;
};

export type AccountsChangedDetail = {
  action: "login" | "logout" | "switch" | "delete" | "refresh";
  sec_uid?: string;
  nickname?: string;
};

function emitAppEvent<T>(eventName: string, detail: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<T>(eventName, { detail }));
}

function onAppEvent<T>(eventName: string, handler: (detail: T) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    handler(((event as CustomEvent<T>).detail || {}) as T);
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}

export function emitCookieInvalid(detail: CookieInvalidDetail): void {
  emitAppEvent(COOKIE_INVALID_EVENT, detail);
}

export function onCookieInvalid(handler: (detail: CookieInvalidDetail) => void): () => void {
  return onAppEvent(COOKIE_INVALID_EVENT, handler);
}

export function emitCookieLoginStatus(detail: CookieLoginStatusDetail): void {
  emitAppEvent(COOKIE_LOGIN_STATUS_EVENT, detail);
}

export function onCookieLoginStatus(handler: (detail: CookieLoginStatusDetail) => void): () => void {
  return onAppEvent(COOKIE_LOGIN_STATUS_EVENT, handler);
}

export function emitAccountsChanged(detail: AccountsChangedDetail): void {
  emitAppEvent(ACCOUNTS_CHANGED_EVENT, detail);
}

export function onAccountsChanged(handler: (detail: AccountsChangedDetail) => void): () => void {
  return onAppEvent(ACCOUNTS_CHANGED_EVENT, handler);
}
