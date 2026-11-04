import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReceiptText } from "lucide-react";

export default function TransactionsPage() {
  return (
    <PageContainer className="py-12">
      <EmptyState
        icon={<ReceiptText className="h-8 w-8" />}
        title="Transactions"
        description="Your swap history will appear here once the trading flow is wired to the backend."
      />
    </PageContainer>
  );
}
