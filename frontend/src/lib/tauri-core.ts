// Public-shell shim for direct imports of the desktop bridge helpers.
// All implementations are exported from the mock facade and never invoke Tauri.

export {
  getBrowserSocket,
  invoke,
  invokeLocal,
  isBrowserBridgeRuntime,
  isTauriRuntime,
  requestJson,
  shouldUseBrowserBridge,
  toFiniteNumber,
  writeTextWithBrowserClipboard,
} from "./tauri";
