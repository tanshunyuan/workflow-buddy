import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "[font-family:var(--font-serif)] flex min-h-11 w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--background)] px-[14px] py-[10px] text-[14px] leading-[1.6] text-[color:var(--foreground)] outline-none transition-colors file:border-0 file:bg-transparent file:text-[13px] file:font-medium placeholder:text-[rgba(119,106,93,0.5)] placeholder:italic focus-visible:border-[rgba(194,91,53,0.4)] focus-visible:shadow-[0_0_0_3px_var(--ring-shadow)]",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };
