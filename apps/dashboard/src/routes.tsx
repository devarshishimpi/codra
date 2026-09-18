import React, { Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { AppShell } from '@client/components/layout/app-shell';
import { RouteErrorBoundary } from '@client/components/shared/route-error-boundary';
import { navItems as defaultNavItems } from '@client/nav';
import type { NavItem } from '@client/nav';

const LandingPage = React.lazy(() => import('./pages/landing').then(m => ({ default: m.LandingPage })));
const DashboardPage = React.lazy(() => import('./pages/dashboard').then(m => ({ default: m.DashboardPage })));
const JobsPage = React.lazy(() => import('./pages/jobs').then(m => ({ default: m.JobsPage })));
const JobDetailPage = React.lazy(() => import('./pages/job-detail').then(m => ({ default: m.JobDetailPage })));
const JobLogsPage = React.lazy(() => import('./pages/job-logs').then(m => ({ default: m.JobLogsPage })));
const ReposPage = React.lazy(() => import('./pages/repos').then(m => ({ default: m.ReposPage })));
const StatsPage = React.lazy(() => import('./pages/stats').then(m => ({ default: m.StatsPage })));
const SettingsPage = React.lazy(() => import('./pages/settings').then(m => ({ default: m.SettingsPage })));
const AccountPage = React.lazy(() => import('./pages/account').then(m => ({ default: m.AccountPage })));
const NotFoundPage = React.lazy(() => import('./pages/not-found').then(m => ({ default: m.NotFoundPage })));

// Render failures, including a failed lazy chunk, bubble to the branch's `errorElement` so there is one styled fallback instead of two.
export const withSuspense = (Component: React.ComponentType, isFullPage = false) => (
  <Suspense fallback={<div role="status" aria-busy="true" className={`flex items-center justify-center ${isFullPage ? 'h-screen' : 'h-full w-full'}`} />}>
    <Component />
  </Suspense>
);

export const publicRoutes: RouteObject[] = [
  {
    path: '/',
    element: withSuspense(LandingPage, true),
    errorElement: <RouteErrorBoundary />,
  },
];

// A boundary per child too, not just on the layout: React Router replaces the whole matched branch, so a branch-only boundary would take the sidebar and header down with a single page.
export const shellRoutes: RouteObject[] = [
  { path: 'dashboard', element: withSuspense(DashboardPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'jobs', element: withSuspense(JobsPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'jobs/:id', element: withSuspense(JobDetailPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'jobs/:id/logs', element: withSuspense(JobLogsPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'repos', element: withSuspense(ReposPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'stats', element: withSuspense(StatsPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'settings', element: withSuspense(SettingsPage), errorElement: <RouteErrorBoundary inline /> },
  { path: 'account', element: withSuspense(AccountPage), errorElement: <RouteErrorBoundary inline /> },
];

export interface RouterExtensions {
  publicRoutes?: RouteObject[];
  shellRoutes?: RouteObject[];
  navItems?: NavItem[];
}

// buildRouter appends the catch-all last so injected routes stay reachable; a route registered after a '*' route would never match.
export function buildRouter(extra: RouterExtensions = {}) {
  return createBrowserRouter([
    ...publicRoutes,
    ...(extra.publicRoutes ?? []),
    {
      element: <AppShell navItems={[...defaultNavItems, ...(extra.navItems ?? [])]} />,
      errorElement: <RouteErrorBoundary />,
      children: [...shellRoutes, ...(extra.shellRoutes ?? [])],
    },
    {
      path: '*',
      element: withSuspense(NotFoundPage, true),
      errorElement: <RouteErrorBoundary />,
    },
  ]);
}
