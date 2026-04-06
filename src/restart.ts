// ---------------------------------------------------------------------------
// Shared restart trigger — avoids circular deps between commands.ts and index.ts
// ---------------------------------------------------------------------------

let _restartFn: (() => void) | null = null;
let _restarting = false;

export function setRestartHandler(fn: () => void): void {
  _restartFn = fn;
}

export function triggerRestart(): void {
  if (_restartFn) {
    _restarting = true;
    _restartFn();
  }
}

export function isRestarting(): boolean {
  return _restarting;
}
