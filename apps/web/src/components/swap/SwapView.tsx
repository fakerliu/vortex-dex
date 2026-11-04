import { PageContainer } from "@/components/layout/PageContainer";
import { SwapCard } from "./SwapCard";

export function SwapView() {
  return (
    <PageContainer className="py-8 md:py-12">
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 md:text-3xl">
            Swap Tokens
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Find the best route across decentralized exchanges.
          </p>
        </div>
        <SwapCard />
      </div>
    </PageContainer>
  );
}
