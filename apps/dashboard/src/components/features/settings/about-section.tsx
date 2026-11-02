import { Badge, LayerCard, SectionCard, Text } from "@codraoss/ui";
import { ExternalLink } from "lucide-react";

// No props and no state, which is why this is a component rather than inlined JSX: it keeps 50 lines of markup out of SettingsPage.
export function AboutSection() {
  return (
    <SectionCard
      title="About"
      description="Version, license, and links for this Codra instance"
    >
      <div className="space-y-3 p-5">
        <LayerCard className="divide-y divide-ui-line rounded-lg">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <Text variant="body" size="sm" bold as="span">
              Version
            </Text>
            <Badge
              variant="outline"
              className="border-ui-brand/30 bg-ui-brand/10 font-mono text-ui-brand"
            >
              v{__APP_VERSION__}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <Text variant="body" size="sm" bold as="span">
              License
            </Text>
            <Badge variant="outline">AGPL-3.0-only</Badge>
          </div>
        </LayerCard>

        <LayerCard className="rounded-lg">
          <div className="grid grid-cols-1 divide-y divide-ui-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              {
                href: "https://github.com/devarshishimpi/codra/releases/",
                label: "Releases",
                sub: "Version history & notes",
              },
              {
                href: "https://codra.run",
                label: "Homepage",
                sub: "codra.run",
              },
              {
                href: "https://github.com/devarshishimpi/codra/issues",
                label: "Report an issue",
                sub: "GitHub issue tracker",
              },
            ].map(({ href, label, sub }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-2.5 px-4 py-4 transition-colors hover:bg-ui-fill/40"
              >
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ui-default group-hover:text-ui-brand">
                    {label}
                    <ExternalLink
                      size={11}
                      className="text-ui-subtle opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-ui-brand"
                    />
                  </span>
                  <span className="mt-0.5 block text-xs text-ui-subtle">
                    {sub}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </LayerCard>
      </div>
    </SectionCard>
  );
}
