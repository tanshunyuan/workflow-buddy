import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "[font-family:var(--font-serif)] flex min-h-[120px] w-full rounded-[12px] border border-[color:var(--line)] bg-[color:var(--background)] px-[14px] py-[10px] text-[14px] leading-[1.6] text-[color:var(--foreground)] outline-none transition-colors placeholder:text-[rgba(119,106,93,0.5)] placeholder:italic focus-visible:border-[rgba(194,91,53,0.4)] focus-visible:shadow-[0_0_0_3px_var(--ring-shadow)]",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Textarea.displayName = "Textarea";

export { Textarea };
