"use client";
import RouteError from "@/components/ErrorBoundaryClient";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} title="Accuracy audit failed to load" />;
}
