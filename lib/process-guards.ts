// Global last-resort handlers for escaped async errors.
//
// Without these, a single unhandled promise rejection or a throw on a
// callback/timer stack tears down the whole Node process — which in a
// parallel eval run means every sibling run dies with it. These handlers
// turn a stray background rejection into a logged, non-fatal event so one
// misbehaving run can't nuke the others.

let installed = false;

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack || `${err.name}: ${err.message}`;
  }
  try {
    return typeof err === 'string' ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Install global `unhandledRejection` / `uncaughtException` handlers.
 *
 * Idempotent: repeated calls are a no-op after the first, so importing this
 * from multiple entrypoints (or calling it more than once) is safe.
 *
 * - `unhandledRejection` is treated as recoverable: we log it and keep the
 *   process alive. A stray rejection from one background run must not take
 *   down sibling runs sharing the process.
 * - `uncaughtException` is logged and then the process exits non-zero. Per
 *   Node guidance, an uncaught exception leaves the process in an undefined
 *   state, so continuing risks silent corruption. This single, deliberate
 *   exit is the one place we choose to bail out.
 */
export function installProcessGuards(): void {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    console.error('[openeval] unhandled promise rejection (non-fatal):');
    console.error(formatError(reason));
  });

  process.on('uncaughtException', (err) => {
    console.error('[openeval] uncaught exception (process state may be corrupt, exiting):');
    console.error(formatError(err));
    // Deliberate: the process is in an undefined state after an uncaught
    // exception, so exit non-zero rather than limp along.
    process.exit(1);
  });
}

/** Test-only: reset the idempotency latch so a fresh install can be exercised. */
export function __resetProcessGuardsForTest(): void {
  installed = false;
}
