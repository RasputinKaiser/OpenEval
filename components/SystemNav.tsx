"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Plug, Settings } from "lucide-react";

const ITEMS = [
  { href: "/harnesses", label: "Harnesses", detail: "CLIs & collection", icon: Plug },
  { href: "/settings", label: "Settings", detail: "Defaults & storage", icon: Settings },
];

/** Compact local navigation keeps the two System tools connected on mobile. */
export default function SystemNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="System" className="system-nav mb-5 flex gap-1 overflow-x-auto rounded-xl">
      {ITEMS.map(({ href, label, detail, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "system-nav__item flex min-w-[148px] flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98]",
              active && "system-nav__item--active",
            )}
          >
            <Icon aria-hidden="true" className={clsx("system-nav__icon size-4 shrink-0", active ? "text-accent-soft" : "")} />
            <span className="min-w-0">
              <span className="block font-medium leading-4">{label}</span>
              <span className="block truncate text-[10px] leading-4 text-fg-dim">{detail}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
