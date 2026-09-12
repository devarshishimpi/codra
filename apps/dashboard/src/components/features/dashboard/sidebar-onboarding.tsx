import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton, OnboardingCard, type OnboardingStep } from '@codraoss/ui';
import { api } from '@client/lib/api';
import type { AuthSessionUser } from '@codraoss/schema/api';

const STORAGE_KEY = 'codra_onboarding_dismissed';

interface SidebarOnboardingProps {
  user: AuthSessionUser;
  onVisibleChange?: (visible: boolean) => void;
}

export function SidebarOnboarding({ user, onVisibleChange }: SidebarOnboardingProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setMounted(true);
    
    // Do not show if previously dismissed permanently
    if (localStorage.getItem(STORAGE_KEY)) {
      setVisible(false);
      onVisibleChange?.(false);
      return;
    }

    Promise.all([
      api.getRepos().catch(() => null),
      api.getModelConfigs().catch(() => null),
    ]).then(([reposRes, modelsRes]) => {
      const hasRepos = Array.isArray(reposRes?.repos) && reposRes.repos.length > 0;
      const enabledRepos = reposRes?.repos?.filter((r) => r.enabled) ?? [];
      const hasEnabledRepo = enabledRepos.length > 0;
      const hasProvider = Array.isArray(modelsRes?.providers) && modelsRes.providers.length > 0;
      const hasModel = Array.isArray(modelsRes?.configs) && modelsRes.configs.length > 0;
      const hasAI = hasProvider && hasModel;

      const loadedSteps: OnboardingStep[] = [
        {
          id: 'repos-install',
          label: 'Install the GitHub App',
          done: hasRepos,
          onClick: () => window.open('/api/repos/install', '_blank'),
        },
        {
          id: 'repos-enable',
          label: 'Enable a repository',
          done: hasEnabledRepo,
          onClick: () => navigate('/repos'),
        },
        {
          id: 'ai-models',
          label: 'Configure AI models',
          done: hasAI,
          onClick: () => navigate('/settings'),
        },
      ];

      setSteps(loadedSteps);
      onVisibleChange?.(true);
    }).finally(() => {
      setLoading(false);
    });
  }, [user, onVisibleChange, navigate]);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
    onVisibleChange?.(false);
  };

  if (!mounted || !visible) return null;

  if (loading) {
    return (
      <div className="ui-well mx-2 mb-2 overflow-hidden rounded-lg">
        <div className="px-3.5 pb-3.5 pt-5">
          <div className="mb-3.5 space-y-2 text-center">
            <Skeleton height={20} className="mx-auto w-32" />
            <Skeleton height={16} className="mx-auto w-48" />
          </div>
          <div className="mb-3.5">
            <Skeleton height={22} className="w-full" />
          </div>
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={33} borderRadius={6} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <OnboardingCard
      title="You're almost there!"
      completedTitle="You're all set! 🎉"
      description="Complete the steps to start reviewing PRs."
      steps={steps}
      onDismiss={handleDismiss}
      className="mx-2 mb-2"
    />
  );
}
