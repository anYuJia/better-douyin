// Public-shell shim for media URL helpers used by the application bootstrap.
// The mock facade returns local demo-safe URLs only.

export {
  configureMediaProxyBaseUrl,
  localFileAssetUrl,
  mediaProxyUrl,
} from "./tauri";
