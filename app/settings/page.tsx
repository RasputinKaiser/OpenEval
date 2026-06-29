import SettingsClient from "@/components/SettingsClient";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings — OpenEval" };

export default function SettingsPage() {
  return <SettingsClient />;
}