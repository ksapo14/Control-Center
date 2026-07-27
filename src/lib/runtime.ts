export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
