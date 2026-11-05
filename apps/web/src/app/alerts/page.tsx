import { AlertsView } from "@/components/alerts/AlertsView";

/**
 * 价格提醒页（App Router 下 searchParams 为 Promise，需 await 解包）。
 * 支持从 Token Detail 页跳转预填：/alerts?chainId=&tokenAddress=&symbol=。
 */
export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{
    chainId?: string;
    tokenAddress?: string;
    symbol?: string;
  }>;
}) {
  const sp = await searchParams;
  return (
    <AlertsView
      initialChainId={sp.chainId}
      initialTokenAddress={sp.tokenAddress}
      initialSymbol={sp.symbol}
    />
  );
}
