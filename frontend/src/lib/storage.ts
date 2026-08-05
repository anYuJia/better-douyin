function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function readString(key: string, fallback = ""): string {
  try {
    const storage = getLocalStorage();
    if (!storage) return fallback;
    const value = storage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(key, value);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function removeStorageKey(key: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.removeItem(key);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readBoolean(key: string, fallback = false): boolean {
  try {
    const storage = getLocalStorage();
    if (!storage) return fallback;
    const value = storage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export function writeBoolean(key: string, value: boolean): void {
  writeString(key, String(value));
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const storage = getLocalStorage();
    if (!storage) return fallback;
    const value = storage.getItem(key);
    if (value === null) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Ignore stringify or storage failures.
  }
}
