import Link from "next/link";
import { NavLinks } from "@/components/navigation/NavLinks";
import { NetworkSelector } from "@/components/wallet/NetworkSelector";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { PageContainer } from "./PageContainer";

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500 text-white">
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M1.5 2.5C5 7 9 10 16.5 2.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M1.5 15.5C5 11 9 8 16.5 15.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <PageContainer className="flex h-[60px] items-center justify-between gap-4 md:h-[72px]">
        <div className="flex items-center gap-6">
          <Link href="/swap" className="flex items-center gap-2">
            <LogoMark />
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold tracking-tight text-gray-950">
                VORTEX
              </span>
              <span className="rounded bg-accent-500/10 px-1 py-0.5 text-[11px] font-semibold text-accent-500">
                DEX
              </span>
            </div>
          </Link>
          <NavLinks />
        </div>

        <div className="flex items-center gap-2">
          <NetworkSelector />
          <WalletConnectButton />
        </div>
      </PageContainer>
    </header>
  );
}
