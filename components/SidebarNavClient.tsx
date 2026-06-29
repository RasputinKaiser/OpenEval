"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useGotoNavigation } from "@/lib/use-goto-navigation";
import { cachedFetch } from "@/lib/cached-fetch";

const CommandPalette = dynamic(() => import("./CommandPalette"));
const ShortcutsOverlay = dynamic(() => import("./ShortcutsOverlay"));

interface RunLite {
  id: string;
  name: string;
}

export default function SidebarNavClient() {
  useGotoNavigation();
  const [runs, setRuns] = useState<RunLite[]>([]);

  useEffect(() => {
    cachedFetch<{ runs: RunLite[] }>("/api/runs")
      .then((d) => setRuns((d.runs ?? []).slice(0, 10)))
      .catch(() => {});
  }, []);

  return (
    <>
      <CommandPalette runs={runs} />
      <ShortcutsOverlay />
    </>
  );
}