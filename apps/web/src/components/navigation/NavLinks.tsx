"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/utils/cn";

const LINKS = [
  { href: "/swap", label: "Swap" },
  { href: "/explore", label: "Explore" },
  { href: "/transactions", label: "Transactions" },
  { href: "/analytics", label: "Analytics" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(link.href + "/");
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-gray-100 text-gray-950"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-950",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
