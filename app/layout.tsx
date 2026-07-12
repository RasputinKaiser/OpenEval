import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { ToastProvider } from "@/components/ToastProvider";
import SidebarNavClient from "@/components/SidebarNavClient";
import MobileNav from "@/components/MobileNav";
import OnboardingOverlay from "@/components/OnboardingOverlay";

export const metadata: Metadata = {
  title: "OpenEval",
  description: "OpenEval — agent-CLI evaluation harness",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{const t=localStorage.getItem('openeval-theme');if(t==='light'||(!t&&matchMedia('(prefers-color-scheme: light)').matches))document.documentElement.classList.add('light')}catch(e){}" }} />
      </head>
      <body className="min-h-screen bg-bg text-fg font-sans antialiased">
        <ToastProvider>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            {/* overflow-x-clip, not -hidden: hidden makes <main> a scroll container, which breaks position:sticky inside pages */}
            <main className="flex-1 min-w-0 overflow-x-clip">{children}</main>
          </div>
          <MobileNav />
          <SidebarNavClient />
          <OnboardingOverlay />
        </ToastProvider>
      </body>
    </html>
  );
}