import * as React from "react";
import { cn } from "../lib/utils";

/** Uses the `ui-*` surface tokens defined in app.css. */
const LayerCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-lg border border-ui-line bg-ui-base", className)}
    {...props}
  />
));
LayerCard.displayName = "LayerCard";

export { LayerCard };
