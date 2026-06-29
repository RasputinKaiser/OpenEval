import { useEffect, useRef } from "react";

type KeyHandler = (e: KeyboardEvent) => void;

const listeners = new Set<KeyHandler>();
let globalListener: ((e: KeyboardEvent) => void) | null = null;

function ensureGlobalListener() {
  if (globalListener || typeof window === "undefined") return;
  globalListener = (e: KeyboardEvent) => {
    for (const handler of listeners) {
      handler(e);
    }
  };
  window.addEventListener("keydown", globalListener);
}

function removeGlobalListener() {
  if (!globalListener || typeof window === "undefined") return;
  if (listeners.size === 0) {
    window.removeEventListener("keydown", globalListener);
    globalListener = null;
  }
}

export function useGlobalKeyHandler(handler: KeyHandler, deps: unknown[] = []) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapped = (e: KeyboardEvent) => handlerRef.current(e);
    listeners.add(wrapped);
    ensureGlobalListener();
    return () => {
      listeners.delete(wrapped);
      removeGlobalListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}