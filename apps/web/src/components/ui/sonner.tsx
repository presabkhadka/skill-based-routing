import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner wired to the app's design tokens rather than its own palette, so
 * toasts inherit the console's card/border/foreground colours and follow the
 * light and dark themes without a second source of truth.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      duration={6000}
      toastOptions={{
        classNames: {
          toast:
            "group flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg",
          title: "text-sm font-semibold leading-snug",
          description: "text-sm text-muted-foreground leading-snug mt-0.5",
          actionButton:
            "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
          closeButton:
            "rounded-md border border-border bg-card text-muted-foreground hover:text-foreground",
          icon: "shrink-0 mt-0.5",
        },
      }}
      {...props}
    />
  );
}
