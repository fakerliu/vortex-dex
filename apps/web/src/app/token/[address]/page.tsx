import { TokenDetailView } from "@/components/market/TokenDetailView";
import { BASE_CHAIN_ID } from "@/config/tokens";

/**
 * Token 详情页（App Router 下 params 为 Promise，需 await 解包）。
 * 地址交由 TokenDetailView 拉取元数据 + 价格。
 */
export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <TokenDetailView address={address} chainId={BASE_CHAIN_ID} />;
}
