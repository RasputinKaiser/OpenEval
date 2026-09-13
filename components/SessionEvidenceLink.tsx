"use client";
import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { parseChartSelection, selectionParams } from "@/lib/chart-analysis";
export function SessionEvidenceLink(props: ComponentProps<typeof Link>) {
  const [context, setContext] = useState("");
  useEffect(() => {
    const read = () => { const params = selectionParams(parseChartSelection(new URLSearchParams(window.location.search)).selection); params.set("returnTo", window.location.pathname); setContext(params.toString()); };
    read(); window.addEventListener("popstate", read); window.addEventListener("openeval:chart-selection", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("openeval:chart-selection", read); };
  }, []);
  const href = typeof props.href === "string" && context ? `${props.href}${props.href.includes("?") ? "&" : "?"}${context}` : props.href;
  return <Link {...props} href={href} />;
}
