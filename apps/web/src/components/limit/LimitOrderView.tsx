"use client";

import { useAccount } from "wagmi";
import { Wallet } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletConnectButton } from "@/components/wallet/WalletConnectButton";
import { LimitOrderForm } from "./LimitOrderForm";
import { LimitOrderList } from "./LimitOrderList";

export function LimitOrderView() {
  const { isConnected, address } = useAccount();

  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Limit Orders
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Place an order that fills automatically when the market reaches your
            target price.
          </p>
        </div>

        {!isConnected || !address ? (
          <EmptyState
            icon={<Wallet className="h-8 w-8" />}
            title="Connect your wallet"
            description="Connect a wallet to place and manage limit orders."
            action={<WalletConnectButton />}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[420px_1fr]">
            <LimitOrderForm />
            <LimitOrderList />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
