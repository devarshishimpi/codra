import { NavLink, useMatch, useResolvedPath } from "react-router-dom";
import { type ComponentType } from "react";
import { cn } from "@codraoss/ui/utils";

/**
 * Resolves active state via hooks instead of NavLink's render-prop pattern,
 * so SharedLayoutBg's cloneElement receives plain JSX children rather than a
 * function.
 */
export function SidebarNavItem({
  to,
  end,
  label,
  icon: Icon,
  onClick,
}: {
  to: string;
  end: boolean;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  onClick: () => void;
}) {
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end });
  const isActive = match !== null;

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={cn(
        "dashboard-sidebar-action",
        // `relative` anchors this row's own accent bar + skimmer overlay; the rest of the sidebar rows are positioned the same way.
        "group relative flex h-10 w-full items-center gap-3 rounded-md pl-4 pr-3.5 text-[13px] font-medium",
        "outline-none transition-[color,background-color] duration-200 ease-[var(--ease-out-quart)]",
        "focus-visible:ring-2 focus-visible:ring-ring",
        isActive
          ? "bg-ui-fill/60 font-semibold text-ui-strong"
          : "text-ui-default hover:text-ui-strong dark:text-ui-subtle dark:hover:text-ui-default",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--btn-primary-bg)]",
          "z-20 transition-opacity duration-200",
          isActive ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Skimmer shine: brand-tinted light beam that sweeps on hover (CSS in app.css); only rendered when active. */}
      {isActive && (
        <span
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-md"
          aria-hidden="true"
        >
          <span className="dashboard-sidebar-shine absolute inset-0 flex justify-center">
            <span className="h-full w-12 bg-gradient-to-r from-transparent via-[var(--btn-primary-bg)]/30 to-transparent" />
          </span>
        </span>
      )}

      {/* Muted a step below the label when inactive, matching icon chips elsewhere; dark mode has no mid tone between `ui-subtle` and `ui-default`, so the step comes from alpha, otherwise icon and label render at the identical grey. */}
      <span
        className={cn(
          "relative z-10 flex shrink-0 items-center justify-center transition-colors duration-200",
          !isActive &&
            "text-ui-subtle group-hover:text-ui-default dark:text-ui-subtle/65 dark:group-hover:text-ui-subtle",
        )}
      >
        <Icon size={15} strokeWidth={isActive ? 2.4 : 2} />
      </span>

      <span className="relative z-10 min-w-0 flex-1 truncate">{label}</span>
    </NavLink>
  );
}
