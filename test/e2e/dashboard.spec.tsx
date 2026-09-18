/**
 * @vitest-environment jsdom
 */
import { expect, it, describe, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginPage } from '@client/pages/login';
import { DashboardPage } from '@client/pages/dashboard';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@client/lib/api';
import { ThemeProvider } from '@codraoss/ui/theme';

vi.mock('@client/lib/api', () => ({
  api: {
    getSession: vi.fn(),
    getUpdatesEmailStatus: vi.fn(),
    subscribeUpdates: vi.fn(),
    getStats: vi.fn(),
    getJobs: vi.fn(),
    getRepos: vi.fn(),
    getModelConfigs: vi.fn(),
  }
}));

describe('Frontend UI Flows (JSDOM)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getUpdatesEmailStatus).mockResolvedValue({
      status: 'subscribed',
      email: 'user@example.com',
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.getRepos).mockResolvedValue({ repos: [] });
    vi.mocked(api.getModelConfigs).mockResolvedValue({ providers: [], configs: [] });
  });

  it('renders the GitHub sign-in flow', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </ThemeProvider>
    );

    const signInLink = screen.getByRole('link', { name: 'Sign in with GitHub' });
    expect(signInLink.getAttribute('href')).toBe('/auth/github');
  });

  it('displays the dashboard with stats and activity', async () => {
    vi.mocked(api.getStats).mockResolvedValue({
      stats: {
        totals: { jobs: 10, inputTokens: 500, outputTokens: 250, comments: 5 },
        trend: [],
        trendBucketDays: 1,
        verdicts: [],
        models: [],
        topRepos: [],
        statuses: [],
        triggers: [],
        severities: [],
        categories: [],
        performance: { avgDurationMs: null, p95DurationMs: null, avgConfidence: null },
      }
    });

    vi.mocked(api.getJobs).mockResolvedValue({
      jobs: [
        {
          id: '1',
          owner: 'test-owner',
          repo: 'test-repo',
          prNumber: 101,
          prTitle: 'Fixing bug',
          status: 'done',
          trigger: 'auto',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          commentCount: 2,
        }
      ] as any,
      total: 1
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('Dashboard')).toBeDefined();

    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('500')).toBeDefined();

    // Rendered in both mobile and desktop layouts, hence getAllByText.
    expect(screen.getAllByText('test-owner/test-repo').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Fixing bug' })).toBeDefined();
  });
});
