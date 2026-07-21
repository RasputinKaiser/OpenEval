import assert from "node:assert/strict";
import test from "node:test";
import { installProcessGuards, __resetProcessGuardsForTest } from "../lib/process-guards";

type Ev = "unhandledRejection" | "uncaughtException";

function listenersOf(ev: Ev): Function[] {
  return process.listeners(ev as NodeJS.Signals) as Function[];
}

// Remove only the listeners added since `before` was captured, so we never
// strip node:test's own protective handlers.
function restoreListeners(ev: Ev, before: Function[]): void {
  for (const l of listenersOf(ev)) {
    if (!before.includes(l)) process.removeListener(ev as NodeJS.Signals, l as (...a: unknown[]) => void);
  }
}

test("installProcessGuards is idempotent — repeated calls add listeners only once", () => {
  __resetProcessGuardsForTest();

  const beforeRej = listenersOf("unhandledRejection");
  const beforeExc = listenersOf("uncaughtException");

  try {
    installProcessGuards();
    installProcessGuards();
    installProcessGuards();

    assert.equal(
      process.listenerCount("unhandledRejection"),
      beforeRej.length + 1,
      "exactly one unhandledRejection listener should be added",
    );
    assert.equal(
      process.listenerCount("uncaughtException"),
      beforeExc.length + 1,
      "exactly one uncaughtException listener should be added",
    );
  } finally {
    restoreListeners("unhandledRejection", beforeRej);
    restoreListeners("uncaughtException", beforeExc);
    __resetProcessGuardsForTest();
  }
});

test("an unhandledRejection is handled by our listener without crashing the process", () => {
  __resetProcessGuardsForTest();

  const beforeRej = listenersOf("unhandledRejection");
  const beforeExc = listenersOf("uncaughtException");

  const origError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };

  try {
    installProcessGuards();
    // Invoke exactly the listener our guard installed (the one added since we
    // captured `beforeRej`). We call it directly rather than via process.emit
    // so we don't also trigger node:test's own protective rejection handler,
    // which would fail this test. This proves our handler runs and swallows
    // the rejection instead of letting it escape.
    const ours = listenersOf("unhandledRejection").filter((l) => !beforeRej.includes(l)) as Array<
      (reason: unknown, promise: Promise<unknown>) => void
    >;
    assert.equal(ours.length, 1, "our single rejection listener should be present");

    ours[0](new Error("boom-from-background-run"), Promise.resolve());

    assert.ok(
      logged.some((line) => line.includes("unhandled promise rejection")),
      "our handler should log the rejection",
    );
    assert.ok(
      logged.some((line) => line.includes("boom-from-background-run")),
      "our handler should include the error detail",
    );
  } finally {
    console.error = origError;
    restoreListeners("unhandledRejection", beforeRej);
    restoreListeners("uncaughtException", beforeExc);
    __resetProcessGuardsForTest();
  }
});
