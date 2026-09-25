import { Button } from "@codraoss/ui";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import {
  AlertTriangle,
  Compass,
  LayoutDashboard,
  RefreshCw,
} from "lucide-react";

interface Presentation {
  code: string;
  title: string;
  hint: string;
  detail?: string;
  icon: typeof AlertTriangle;
  /** A reload can't conjure a route that doesn't exist. */
  reloadable: boolean;
}

/** Route responses (loader `throw new Response`, 404s) read very differently from a crashed render. */
function present(error: unknown): Presentation {
  if (isRouteErrorResponse(error)) {
    const notFound = error.status === 404;
    return {
      code: `ERR_ROUTE_${error.status}`,
      title: notFound
        ? "Resource not found"
        : error.statusText || "Request failed",
      hint: notFound
        ? "That address isn't part of Codra. It may have been moved, or the record it pointed at was deleted."
        : "The server refused this request. Try again, or head back and pick a different route.",
      detail: typeof error.data === "string" ? error.data : undefined,
      icon: notFound ? Compass : AlertTriangle,
      reloadable: !notFound,
    };
  }

  return {
    code: "ERR_RENDER_FAILED",
    title: "Something broke on this screen",
    hint: "The page failed while rendering. Reloading usually clears it; if it keeps happening the details below are worth reporting.",
    detail:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
    icon: AlertTriangle,
    reloadable: true,
  };
}

/**
 * Application fallback for the router's route branches - without it, rendering, loader and action
 * failures land on React Router's unstyled default screen.
 *
 * `inline` is for the routes nested in `AppShell`: those render inside the shell's `<main>`, so the
 * fallback has to be a plain section rather than a second `<main>` filling the viewport. That keeps
 * the sidebar and header alive when a single page crashes, which is what the hand-rolled error
 * boundary this replaced used to do.
 */
export function RouteErrorBoundary({ inline = false }: { inline?: boolean }) {
  const error = useRouteError();
  const { code, title, hint, detail, icon: Icon, reloadable } = present(error);
  const stack =
    import.meta.env.DEV && error instanceof Error ? error.stack : undefined;
  const Container = inline ? "section" : "main";

  return (
    <Container
      role="alert"
      className={
        inline
          ? "ui-font-sans flex min-h-[60vh] flex-col items-center justify-center p-6"
          : "ui-font-sans flex min-h-svh flex-col items-center justify-center bg-background p-6"
      }
    >
      <div className="w-full max-w-md animate-fade-up text-center">
        <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-danger-border bg-danger-bg text-danger">
          <Icon size={22} strokeWidth={1.75} />
        </span>

        <h1 className="text-xl font-semibold tracking-tight text-ui-strong">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ui-subtle">{hint}</p>

        {detail && (
          <code className="ui-well ui-font-mono mt-4 block max-w-full truncate rounded-[5px] px-2 py-1 text-[11px] text-ui-subtle">
            {detail}
          </code>
        )}

        {stack && (
          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-ui-subtle">
              Stack trace
            </summary>
            <pre className="ui-well ui-font-mono mt-2 max-h-64 overflow-auto rounded-[5px] p-2 text-[11px] leading-relaxed text-ui-subtle">
              {stack}
            </pre>
          </details>
        )}

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {reloadable && (
            <Button
              variant="secondary"
              icon={<RefreshCw size={14} />}
              onClick={() => window.location.reload()}
            >
              Reload page
            </Button>
          )}
          <Button asChild>
            <Link to="/dashboard">
              <LayoutDashboard size={14} />
              Back to dashboard
            </Link>
          </Button>
        </div>

        <p className="mt-12 border-t border-ui-line pt-6 text-[10px] uppercase tracking-[0.2em] text-ui-subtle/70 ui-font-mono">
          Error code: {code}
        </p>
      </div>
    </Container>
  );
}
