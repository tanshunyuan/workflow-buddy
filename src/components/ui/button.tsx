import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "[font-family:var(--font-serif)] inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border text-[13px] font-medium leading-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-[rgba(194,91,53,0.4)] focus-visible:shadow-[0_0_0_3px_var(--ring-shadow)]",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--foreground)] bg-[color:var(--foreground)] text-[color:var(--background)] hover:bg-[color:var(--ink-soft)] hover:border-[color:var(--ink-soft)]",
        outline:
          "border-[color:var(--foreground)] bg-transparent text-[color:var(--foreground)] hover:bg-[color:var(--foreground)] hover:text-[color:var(--background)]",
        ghost:
          "border-[color:var(--line)] bg-transparent text-[color:var(--muted-foreground)] hover:bg-[color:var(--panel-strong)] hover:text-[color:var(--foreground)]",
        stop:
          "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:border-[color:var(--ring)] hover:bg-[color:var(--ring)]"
      },
      size: {
        default: "min-h-9 px-[18px] py-2",
        sm: "min-h-8 px-3 py-1.5 text-[12px]",
        lg: "min-h-10 px-5 py-2.5",
        icon: "h-9 w-9 px-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
