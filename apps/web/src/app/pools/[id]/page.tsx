import { PoolDetailView } from "@/components/pool/PoolDetailView";

/**
 * 池详情页（App Router 下 params 为 Promise，需 await 解包）。
 * id 为 pool 记录 id（后端 GET /pools/:id 的路径参数）。
 */
export default async function PoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PoolDetailView id={id} />;
}
