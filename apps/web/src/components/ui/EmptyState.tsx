import { cn } from "@/utils/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-gray-300 bg-gray-100 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-gray-400">{icon}</div>}
      <div className="text-base font-semibold text-gray-800">{title}</div>
      {description && (
        <div className="max-w-sm text-sm text-gray-500">{description}</div>
      )}
      {action}
    </div>
  );
}
