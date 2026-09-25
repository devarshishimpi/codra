import { GithubMark } from "@codraoss/ui";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "@client/lib/api";
import { ArrowUpRight, LogOut, ChevronsUpDown, UserRound } from "lucide-react";
import { cn } from "@codraoss/ui/utils";
import type { AuthSessionUser } from "@codraoss/schema/api";

/** Shared by the pill trigger and the menu's identity header. */
function Avatar({
  user,
  initial,
  size,
}: {
  user: AuthSessionUser;
  initial: string;
  size: number;
}) {
  const box = { width: size, height: size };

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        style={box}
        className="shrink-0 rounded-md object-cover ring-1 ring-ui-line"
      />
    );
  }

  return (
    <span
      style={box}
      className="flex shrink-0 items-center justify-center rounded-md bg-ui-fill text-xs font-semibold text-ui-strong ring-1 ring-ui-line"
    >
      {initial}
    </span>
  );
}

/** One row in the menu: icon, label, and an optional trailing affordance. */
const ITEM = cn(
  "group/item flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[13px] font-medium",
  "text-ui-default outline-none transition-colors duration-150",
);

const ITEM_ICON =
  "shrink-0 text-ui-subtle transition-colors group-hover/item:text-ui-default";

/**
 * Built from scratch (no shared dropdown primitive): a local popover anchored
 * to the account row via `absolute bottom-full`, so it opens directly above
 * the row and moves with the sidebar.
 */
export function AccountMenu({ user }: { user: AuthSessionUser }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const name = user.name?.trim() || user.login;
  const initial = name.charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {/* Repeats the identity as the panel's header so the menu has a subject of its own. Stays
          mounted and animates via CSS, and is `invisible` + `pointer-events-none` when closed so it
          can't sit on top of rows behind it and swallow clicks. */}
      <div
        role="menu"
        aria-hidden={!open}
        style={{ transformOrigin: "bottom center" }}
        className={cn(
          "absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50",
          // rounded-lg = the app's panel/dropdown radius token (11px).
          "rounded-lg border border-ui-line bg-ui-base p-1.5",
          "shadow-[0_12px_32px_-10px_oklch(0%_0_0/0.22)] dark:shadow-[0_12px_32px_-10px_oklch(0%_0_0/0.7)]",
          "transition-[opacity,transform,visibility] duration-150 ease-[var(--ease-out-quart)]",
          open
            ? "visible translate-y-0 scale-100 opacity-100"
            : "invisible pointer-events-none translate-y-1 scale-95 opacity-0",
        )}
      >
        <div className="flex min-w-0 items-center gap-3 px-3 pb-2.5 pt-2">
          <Avatar user={user} initial={initial} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-ui-strong">
              {name}
            </span>
            <span className="ui-font-mono mt-0.5 block truncate text-[11px] leading-tight text-ui-subtle">
              @{user.login}
            </span>
          </span>
        </div>

        <div className="mx-3 mb-1 h-px bg-ui-line" />

        <Link
          role="menuitem"
          to="/account"
          tabIndex={open ? 0 : -1}
          className={cn(
            ITEM,
            "hover:bg-ui-fill hover:text-ui-strong focus-visible:bg-ui-fill focus-visible:text-ui-strong",
          )}
          onClick={() => setOpen(false)}
        >
          <UserRound size={15} strokeWidth={2} className={ITEM_ICON} />
          <span className="min-w-0 flex-1 truncate">Account</span>
        </Link>

        <a
          role="menuitem"
          href={`https://github.com/${user.login}`}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={open ? 0 : -1}
          className={cn(
            ITEM,
            "hover:bg-ui-fill hover:text-ui-strong focus-visible:bg-ui-fill focus-visible:text-ui-strong",
          )}
          onClick={() => setOpen(false)}
        >
          <GithubMark size={15} className={ITEM_ICON} />
          <span className="min-w-0 flex-1 truncate">GitHub profile</span>
          {/* Marks the one item that leaves the app. */}
          <ArrowUpRight
            size={13}
            className="shrink-0 text-ui-subtle opacity-0 transition-opacity group-hover/item:opacity-100"
          />
        </a>

        <div className="mx-3 my-1 h-px bg-ui-line" />

        <button
          role="menuitem"
          type="button"
          tabIndex={open ? 0 : -1}
          className={cn(
            ITEM,
            "hover:bg-danger-bg hover:text-danger focus-visible:bg-danger-bg focus-visible:text-danger",
          )}
          onClick={async () => {
            setOpen(false);
            await api.logout();
            location.href = "/";
          }}
        >
          <LogOut
            size={15}
            strokeWidth={2}
            className="shrink-0 text-ui-subtle transition-colors group-hover/item:text-danger"
          />
          <span className="min-w-0 flex-1 truncate">Log out</span>
        </button>
      </div>

      {/* Avatar, name over handle, and the double chevron. Geometry (full width, radius, spacing)
          matches the sidebar rows above it. */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${name} (@${user.login}) account menu`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "dashboard-sidebar-action",
          // `ui-well` is the recessed inner-panel surface used inside the double cards, so the row
          // reads as the same material (and inherits its text tokens) rather than as bare sidebar.
          "ui-well group relative flex w-full items-center gap-3 rounded-md py-3 pl-4 pr-3 text-left",
          "text-ui-default outline-none",
          "transition-colors duration-200 ease-[var(--ease-out-quart)]",
          "hover:bg-ui-fill/60 focus-visible:ring-2 focus-visible:ring-ring",
          open && "bg-ui-fill/60",
        )}
      >
        <Avatar user={user} initial={initial} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-ui-default">
            {name}
          </span>
          <span className="ui-font-mono mt-0.5 block truncate text-[11px] leading-tight text-ui-subtle">
            @{user.login}
          </span>
        </span>
        <ChevronsUpDown
          size={15}
          strokeWidth={2}
          className="shrink-0 text-ui-subtle transition-transform duration-200 group-aria-expanded:rotate-180"
        />
      </button>
    </div>
  );
}
