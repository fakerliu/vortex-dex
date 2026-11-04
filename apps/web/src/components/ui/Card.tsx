import { cn } from "@/utils/cn";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-gray-200 bg-white p-5",
        className,
      )}
      {...props}
    />
  );
}
