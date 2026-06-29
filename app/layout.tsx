import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import SidebarNavClient from "@/components/SidebarNavClient";
import MobileNav from "@/components/MobileNav";
import { ToastProvider } from "@/components/ToastProvider";
import OnboardingOverlay from "@/components/OnboardingOverlay";

export const metadata: Metadata = {
  title: "NEval",
  description: "NEval — agent-CLI evaluation harness",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-fg font-sans antialiased">
        <ToastProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
          </div>
          <MobileNav />
          <SidebarNavClient />
          <OnboardingOverlay />
        </ToastProvider>
      </body>
    </html>
  );
}