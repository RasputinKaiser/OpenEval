"use client";

import { useEffect, useState } from "react";
import CommandPalette from "./CommandPalette";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useGotoNavigation } from "@/lib/use-goto-navigation";

interface RunLite {
  id: string;
  name: string;
}

export default function SidebarNavClient() {
  useGotoNavigation();
  const [runs, setRuns] = useState<RunLite[]>([]);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.ok ? r.json() : { runs: [] })
      .then((d) => {
        const allRuns = d.runs ?? d ?? [];
        setRuns((allRuns as Array<{ id: string; name: string }>).slice(0, 10));
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <CommandPalette runs={runs} />
      <ShortcutsOverlay />
    </>
  );
}