"use client";
import RouteError from "@/components/ErrorBoundaryClient";
export default function Error(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} title="Page failed to load" />;
}