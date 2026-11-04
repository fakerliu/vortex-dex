import { TransactionDetailView } from "@/components/history/TransactionDetailView";

/**
 * 交易详情页（App Router 下 params 为 Promise，需 await 解包）。
 *
 * 注意：路径参数是 swap 记录 id（非 txHash）——后端仅提供 GET /swaps/:id 的按 id 查询，
 * 前端历史列表条目（SwapHistoryRecord）同时携带 id 与 txHash，故详情页用 id 标识。
 */
export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TransactionDetailView id={id} />;
}
