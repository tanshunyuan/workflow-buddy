import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "[font-family:var(--font-mono)] inline-flex items-center rounded-full px-[10px] py-[3px] text-[10px] font-semibold uppercase tracking-[0.16em]",
  {
    variants: {
      variant: {
        default: "border border-[color:var(--line)] bg-[color:var(--panel-strong)] text-[color:var(--muted-foreground)]",
        accent: "border border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
        subtle: "border border-[color:var(--line)] bg-transparent text-[color:var(--muted-foreground)]",
        completed: "border border-[rgba(100,120,80,0.2)] bg-[rgba(100,120,80,0.12)] text-[#4a5e38]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
