"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
/**
 * Sonner's stylesheet, imported EXPLICITLY rather than left to the library.
 *
 * Sonner injects its ~15 KB of CSS as an inline `<style>` element at runtime.
 * The Content-Security-Policy now refuses inline `<style>` elements
 * (`style-src-elem 'self'` — see apps/server/src/middleware/security.ts), so
 * that injected block is blocked and every toast would render completely
 * unstyled.
 *
 * Importing the same CSS through the bundler makes it an ordinary same-origin
 * stylesheet, which the policy allows. The library still injects its duplicate
 * and the browser still blocks it — harmlessly, because these rules are already
 * present.
 *
 * THIS IMPORT IS LOAD-BEARING. Removing it, or a sonner upgrade that changes
 * where its CSS lives, silently unstyles every toast in the app.
 */
import "sonner/dist/styles.css"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          closeButton:
            "!top-2 !right-2 !size-5 !border-none !bg-transparent !text-muted-foreground hover:!text-foreground hover:!bg-accent",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--toast-close-button-start": "unset",
          "--toast-close-button-end": "0",
          "--toast-close-button-transform": "none",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
