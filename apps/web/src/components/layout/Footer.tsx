import Link from "next/link";
import { PageContainer } from "./PageContainer";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white">
      <PageContainer className="flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-950">VORTEX</span>
          <span className="rounded bg-accent-500/10 px-1.5 py-0.5 text-xs font-medium text-accent-500">
            DEX
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
          <Link href="/swap" className="transition-colors hover:text-gray-800">
            Swap
          </Link>
          <Link
            href="/transactions"
            className="transition-colors hover:text-gray-800"
          >
            Transactions
          </Link>
          <Link href="/analytics" className="transition-colors hover:text-gray-800">
            Analytics
          </Link>
        </div>
        <p className="text-xs text-gray-500">
          © {new Date().getFullYear()} VORTEX DEX. Experimental interface.
        </p>
      </PageContainer>
    </footer>
  );
}
