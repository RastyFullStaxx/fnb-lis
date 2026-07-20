import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      /**
       * Status badges are SOLID with white text (client req, 2026-07-21).
       * Green and amber fill with their deep values, not the base tokens:
       * white on --success is 4.44:1 and on --warning 3.71:1, both under the
       * AA floor, while the deep shades measure 5.5:1 and 6.1:1. The base
       * tokens stay for row tints and chart series.
       */
      variant: {
        default: "bg-primary text-white [a&]:hover:bg-primary/90",
        success: "bg-success-text text-white [a&]:hover:bg-success-text/90",
        warning: "bg-warning-text text-white [a&]:hover:bg-warning-text/90",
        destructive:
          "bg-destructive text-white focus-visible:ring-destructive/20 [a&]:hover:bg-destructive/90",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        outline:
          "border-border text-muted-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
