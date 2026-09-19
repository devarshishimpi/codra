import { Button, GithubMark, LinkButton } from '@codraoss/ui';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@codraoss/ui/theme';

const TERMS_URL = 'https://codra.run/terms';
const PRIVACY_URL = 'https://codra.run/privacy';

const dotGrid = {
  backgroundImage:
    'radial-gradient(circle, var(--ui-line) 1px, transparent 1.5px)',
  backgroundSize: '22px 22px',
  maskImage:
    'radial-gradient(ellipse 85% 75% at 50% 45%, black 35%, rgba(0, 0, 0, 0.35) 100%)',
  WebkitMaskImage:
    'radial-gradient(ellipse 85% 75% at 50% 45%, black 35%, rgba(0, 0, 0, 0.35) 100%)',
};

function DotGrid() {
  return <div aria-hidden className="pointer-events-none absolute inset-0" style={dotGrid} />;
}

const legalLink =
  'rounded-sm text-ui-default underline-offset-2 transition-colors hover:text-ui-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-brand';

export function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-ui-canvas px-4 py-16 text-ui-default sm:px-6">
      <DotGrid />

      <Button
        variant="secondary"
        size="sm"
        shape="square"
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="absolute right-4 top-4 z-10 min-h-[44px] min-w-[44px] sm:right-6 sm:top-6 sm:min-h-0 sm:min-w-0"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </Button>

      <main className="relative z-10 w-full max-w-[26rem]">
        <div className="rounded-2xl border border-ui-line bg-ui-base px-6 py-10 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.55)] sm:px-10 sm:py-10">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-ui-line bg-ui-canvas">
              <svg
                width="100"
                height="100"
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-14 w-14"
              >
                <rect width="100" height="100" fill={theme === 'dark' ? 'black' : 'white'} />
                <rect x="19" y="31" width="15" height="38" rx="2" fill={theme === 'dark' ? '#C2D200' : '#B5C400'} />
                <rect x="34" y="31" width="15" height="40" rx="2" transform="rotate(-90 34 31)" fill={theme === 'dark' ? '#C2D200' : '#B5C400'} />
                <rect x="34" y="84" width="15" height="40" rx="2" transform="rotate(-90 34 84)" fill={theme === 'dark' ? '#C2D200' : '#B5C400'} />
              </svg>
            </div>

            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ui-strong sm:text-[1.75rem]">
              Sign in to Codra
            </h1>
            <p className="mt-2 text-sm text-ui-subtle">
              Use your GitHub account to open the dashboard.
            </p>
          </div>

          <LinkButton
            variant="primary"
            size="base"
            href="/auth/github"
            icon={<GithubMark size={16} />}
            className="mt-8 !h-11 !w-full !justify-center"
          >
            Continue with GitHub
          </LinkButton>

          <p className="mt-8 text-center text-xs leading-relaxed text-ui-subtle">
            By continuing, you agree to Codra&apos;s{' '}
            <a href={TERMS_URL} className={legalLink}>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href={PRIVACY_URL} className={legalLink}>
              Privacy Statement
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}