import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/ui/EmptyState";
import { BarChart3 } from "lucide-react";

export default function AnalyticsPage() {
  return (
    <PageContainer className="py-12">
      <EmptyState
        icon={<BarChart3 className="h-8 w-8" />}
        title="Analytics"
        description="Pool and volume analytics will be available in a later phase."
      />
    </PageContainer>
  );
}
