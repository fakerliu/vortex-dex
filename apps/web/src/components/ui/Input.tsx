"use client";

import { forwardRef } from "react";
import { cn } from "@/utils/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: "default" | "large";
  error?: boolean;
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      inputSize = "default",
      error = false,
      startAdornment,
      endAdornment,
      ...props
    },
    ref,
  ) => {
    return (
      <div className={cn("relative flex items-center", className)}>
        {startAdornment && (
          <span className="pointer-events-none absolute left-4 flex items-center text-gray-400">
            {startAdornment}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full rounded-xl border bg-white text-gray-950 outline-none transition-colors placeholder:text-gray-400",
            inputSize === "default" ? "h-12 px-4 text-base" : "h-16 px-5 text-xl",
            startAdornment && "pl-11",
            endAdornment && "pr-12",
            error
              ? "border-danger focus:border-danger focus:ring-2 focus:ring-danger/20"
              : "border-gray-300 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20",
            "disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500",
          )}
          {...props}
        />
        {endAdornment && (
          <span className="absolute right-4 flex items-center">{endAdornment}</span>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
