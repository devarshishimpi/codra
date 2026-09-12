import { Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { SharedLayoutBg } from '@codraoss/ui/motion';
import { AlignLeft, Sun, Moon, Star, X, ArrowUpRight } from 'lucide-react';
import { cn } from '@codraoss/ui/utils';
import { useTheme } from '@codraoss/ui/theme';
import codraDark from '@/assets/codra-fullicon-dark.svg';
import codraLight from '@/assets/codra-fullicon-light.svg';
import { SidebarNavItem } from '@client/components/layout/sidebar-nav-item';
import { AccountMenu } from '@client/components/layout/account-menu';
import { navItems as defaultNavItems } from '@client/nav';
import type { NavItem } from '@client/nav';
import { SessionProvider, useSession } from '@client/hooks/use-session';
import { useCan } from '@client/hooks/use-can';
import { SidebarOnboarding } from '@client/components/features/dashboard/sidebar-onboarding';

export function AppShell({ navItems = defaultNavItems }: { navItems?: NavItem[] } = {}) {
  return (
    <SessionProvider>
      <AppShellInner navItems={navItems} />
    </SessionProvider>
  );
}

function SidebarNav({ navItems, onNavigate }: { navItems: NavItem[]; onNavigate: () => void }) {
  return (
    <>
      {navItems.map(({ to, label, end, icon, requiresAction }) => (
        <NavEntry
          key={to}
          to={to}
          label={label}
          end={end}
          icon={icon}
          requiresAction={requiresAction}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

function NavEntry({ to, label, end, icon, requiresAction, onNavigate }: NavItem & { onNavigate: () => void }) {
  const allowed = useCan(requiresAction ?? '*');
  if (requiresAction && !allowed) return null;

  return (
    /* SharedLayoutBg clones this div to inject pill + z-10 wrapper. */
    <div>
      <SidebarNavItem to={to} end={end ?? false} label={label} icon={icon} onClick={onNavigate} />
    </div>
  );
}

function AppShellInner({ navItems }: { navItems: NavItem[] }) {
  const { theme, toggleTheme } = useTheme();
  const { user: sessionUser } = useSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isOnboardingVisible, setIsOnboardingVisible] = useState(true);

  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (e: Event) => {
      let el = e.target as Element | Document | null;
      if (el === document) el = document.scrollingElement;
      if (!(el instanceof Element)) return;
      const node = el;
      node.setAttribute('data-scrolling', 'true');
      const prev = timers.get(node);
      if (prev !== undefined) window.clearTimeout(prev);
      timers.set(node, window.setTimeout(() => node.removeAttribute('data-scrolling'), 700));
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      {mobileMenuOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="fixed inset-0 z-30 cursor-default bg-background/60 backdrop-blur-md focus:outline-none lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          'dashboard-sidebar ui-font-sans',
          'fixed bottom-3 left-3 top-3 z-40 flex flex-col',
          'rounded-xl border border-ui-line bg-background text-ui-default',
          'shadow-[0_6px_20px_-8px_oklch(0%_0_0/0.14)]',
          'dark:shadow-[0_8px_24px_-10px_oklch(0%_0_0/0.42)]',
          'lg:rounded-none lg:border-transparent lg:bg-transparent lg:shadow-none',
          'lg:dark:bg-transparent lg:dark:shadow-none',
          'transition-transform duration-300 ease-[var(--ease-out-expo)]',
          'w-[min(17rem,calc(100vw-1.5rem))]',
          'lg:bottom-4 lg:left-4 lg:top-4',
          'lg:w-[var(--sidebar-width)] lg:translate-x-0',
          'overflow-visible',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]',
        )}
      >

        <div className="relative flex shrink-0 items-center justify-between px-2 py-4">

          <Link
            to="/dashboard"
            className="flex min-w-0 items-center rounded-md pl-4 transition-opacity duration-150 hover:opacity-75"
            aria-label="Codra dashboard"
            onClick={() => setMobileMenuOpen(false)}
          >
            <img
              src={theme === 'dark' ? codraDark : codraLight}
              alt="Codra"
              className="h-7 w-auto rounded-md"
            />
          </Link>

          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ui-subtle transition-colors hover:bg-ui-fill/60 hover:text-ui-strong"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ui-subtle transition-colors hover:bg-ui-fill/60 hover:text-ui-strong lg:hidden"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-visible px-2 pb-3">
          <p className="mb-1.5 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-ui-subtle dark:text-ui-subtle/65">
            Menu
          </p>

          <SharedLayoutBg
            className="gap-1"
            pillClassName="rounded-md bg-ui-fill/50"
          >
            <SidebarNav navItems={navItems} onNavigate={() => setMobileMenuOpen(false)} />
          </SharedLayoutBg>
        </nav>

        <div className="mx-4 h-px shrink-0 bg-ui-line" />

        {isOnboardingVisible && (
          <div className="shrink-0 px-2 pb-2 pt-2">
            <a
              href="https://github.com/devarshishimpi/codra"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'dashboard-sidebar-action',
                'group relative flex h-9 w-full items-center gap-3 rounded-md pl-4 pr-3.5',
                'text-[13px] text-ui-subtle hover:text-ui-strong',
                'dark:text-ui-subtle/65 dark:hover:text-ui-default',
                'transition-colors duration-200 ease-[var(--ease-out-quart)]',
                'hover:bg-ui-fill/50',
              )}
            >
              <Star size={15} strokeWidth={2} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Star on GitHub</span>
              <ArrowUpRight
                size={13}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </a>
          </div>
        )}

        {sessionUser && (
          <SidebarOnboarding
            user={sessionUser}
            onVisibleChange={setIsOnboardingVisible}
          />
        )}

        <div className="shrink-0 space-y-0.5 p-2 pt-2">
          {!isOnboardingVisible && (
            <a
              href="https://github.com/devarshishimpi/codra"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'dashboard-sidebar-action',
                'group relative flex h-9 w-full items-center gap-3 rounded-md pl-4 pr-3.5',
                'text-[13px] text-ui-subtle hover:text-ui-strong',
                'dark:text-ui-subtle/65 dark:hover:text-ui-default',
                'transition-colors duration-200 ease-[var(--ease-out-quart)]',
                'hover:bg-ui-fill/50',
              )}
            >
              <Star size={15} strokeWidth={2} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Star on GitHub</span>
              <ArrowUpRight
                size={13}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </a>
          )}

          {sessionUser && <AccountMenu user={sessionUser} />}
        </div>
      </aside>

      <main
        className={cn(
          'app-shell-content',
          'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          'transition-[margin,color,background-color] duration-300 ease-[var(--ease-out-expo)]',
          'lg:ml-[calc(var(--sidebar-width)+2rem)]',
          'lg:my-4 lg:mr-4 lg:rounded-xl lg:border lg:border-ui-line lg:bg-background',
          'lg:shadow-[0_1px_2px_oklch(0%_0_0/0.04)]',
          'lg:dark:border-[oklch(0.24_0_0)] lg:dark:shadow-none',
        )}
      >

        <header className="flex h-14 shrink-0 items-center justify-between border-b border-ui-line px-4 lg:hidden">
          <button
            className="-ml-2 rounded-md p-2 text-ui-default transition-colors hover:bg-ui-fill hover:text-ui-strong"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <AlignLeft size={20} />
          </button>
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-ui-line bg-ui-base text-ui-default transition-colors hover:bg-ui-fill"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </header>

        {/* `scrollbar-gutter: stable` keeps the gutter reserved either way; otherwise gaining a scrollbar narrows the content, rewrapping text and shifting every measurement taken against this box. */}
        <div className="auto-hide-scroll flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
          <div className="mx-auto flex h-full w-full max-w-screen-2xl flex-col px-4 py-6 md:px-6 md:py-8 lg:px-8">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
