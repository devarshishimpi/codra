import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Boxes, Coins, FolderGit2, ShieldCheck } from "lucide-react";
import type { StatsPayload } from "@codraoss/schema";
import { ChartTooltip, type SeriesMarkers } from "./chart-primitives";
import {
  GraphShell,
  LegendChip,
  ChartDefs,
  MeterList,
  TickMeter,
} from "@codraoss/ui";
import {
  CHART,
  MONO_STACK,
  TICK_COLORS_DARK,
  TICK_COLORS_LIGHT,
  formatCompact,
  formatDay,
  modelName,
} from "./chart-support";

// `equidistantPreserveStart` drops labels on a fixed stride (every 2nd, every 3rd, ...) sized to the
// available width, so the dates stay evenly spaced instead of jumping by uneven gaps.
const X_AXIS_PROPS = {
  dataKey: "day",
  tickFormatter: formatDay,
  interval: "equidistantPreserveStart" as const,
  minTickGap: 12,
};

export function MetricsGridCharts({
  stats,
  isDark,
}: {
  stats: StatsPayload;
  isDark: boolean;
}) {
  const lime = isDark ? CHART.primaryDark : CHART.primary;
  const amber = isDark ? CHART.amberDark : CHART.amber;
  const dangerColor = isDark ? CHART.dangerDark : CHART.danger;
  const infoColor = isDark ? CHART.infoDark : CHART.info;
  const quietColor = isDark ? CHART.quietDark : CHART.quiet;
  const dashColor = isDark ? "rgba(228,228,231,0.75)" : "rgba(63,63,70,0.65)";
  const tickColors = isDark ? TICK_COLORS_DARK : TICK_COLORS_LIGHT;
  // Long ranges arrive pre-combined into multi-day buckets; say so, since each point is a sum, not a day.
  const bucketDays = stats.trendBucketDays ?? 1;
  const bucketNote =
    bucketDays > 1 ? (
      <span className="text-xs text-ui-subtle">{bucketDays}-day totals</span>
    ) : null;
  const repoMax = Math.max(...stats.topRepos.map((repo) => repo.jobs), 1);
  const modelMax = Math.max(...stats.models.map((model) => model.calls), 1);

  // CSS variables don't reliably resolve inside Recharts SVG text, so colors are keyed off the active theme explicitly.
  const axisColor = isDark ? "rgba(228,228,231,0.55)" : "rgba(63,63,70,0.7)";
  const gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const cursorColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const axisProps = {
    fontSize: 10,
    tickLine: false,
    tickMargin: 8,
    axisLine: false,
    tick: { fontFamily: MONO_STACK, fill: axisColor },
  } as const;

  const STATUS_COLOR: Record<string, string> = {
    done: lime,
    running: infoColor,
    queued: quietColor,
    failed: dangerColor,
    superseded: quietColor,
    cancelled: quietColor,
  };
  const statusTotal = Math.max(
    stats.statuses.reduce((sum, s) => sum + s.count, 0),
    1,
  );

  // One description per series, feeding both the legend chip and the tooltip swatch, so the two
  // can't drift apart. Keyed by `dataKey`, which is what Recharts reports back on hover.
  const flowMarkers: SeriesMarkers = {
    jobs: { color: amber },
    comments: { color: dashColor, dashed: true },
  };
  const tokenMarkers: SeriesMarkers = {
    outputTokens: { color: CHART.blue },
    inputTokens: { hatched: true },
  };

  return (
    // Rows only: `MetricsGrid` owns the outer wrapper. See the note there.
    <>
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <GraphShell
          title="Review Flow"
          icon={<Activity size={14} strokeWidth={2} />}
          legend={
            <>
              <LegendChip {...flowMarkers.jobs} label="Reviews" />
              <LegendChip {...flowMarkers.comments} label="Comments" />
              {bucketNote}
            </>
          }
        >
          <div className="h-64 px-1.5 pb-3 pt-3 sm:h-80 sm:px-2 sm:pb-4">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              <AreaChart
                data={stats.trend}
                margin={{ left: 4, right: 8, top: 8, bottom: 4 }}
              >
                <ChartDefs isDark={isDark} />
                <CartesianGrid
                  stroke={gridColor}
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis {...axisProps} {...X_AXIS_PROPS} />
                <YAxis {...axisProps} width={34} allowDecimals={false} />
                <Tooltip
                  content={<ChartTooltip markers={flowMarkers} />}
                  cursor={{ stroke: amber, strokeDasharray: "4 4" }}
                />
                <Area
                  type="stepAfter"
                  dataKey="jobs"
                  name="reviews"
                  stroke={amber}
                  strokeWidth={2}
                  fill="url(#amberFill)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: amber,
                    stroke: "var(--card)",
                    strokeWidth: 2,
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="comments"
                  name="comments"
                  stroke={dashColor}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  fill="transparent"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: dashColor,
                    stroke: "var(--card)",
                    strokeWidth: 2,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>

        <GraphShell
          title="Token Volume"
          icon={<Coins size={14} strokeWidth={2} />}
          legend={
            <>
              <LegendChip
                {...tokenMarkers.outputTokens}
                label="Output tokens"
              />
              <LegendChip {...tokenMarkers.inputTokens} label="Input tokens" />
              {bucketNote}
            </>
          }
        >
          <div className="h-64 px-1.5 pb-3 pt-3 sm:h-80 sm:px-2 sm:pb-4">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
            >
              <BarChart
                data={stats.trend}
                margin={{ left: 4, right: 8, top: 8, bottom: 4 }}
                barCategoryGap="28%"
              >
                <ChartDefs isDark={isDark} />
                <CartesianGrid
                  stroke={gridColor}
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis {...axisProps} {...X_AXIS_PROPS} />
                <YAxis
                  {...axisProps}
                  width={46}
                  tickFormatter={formatCompact}
                />
                <Tooltip
                  content={<ChartTooltip markers={tokenMarkers} />}
                  cursor={{ fill: cursorColor }}
                />
                {/* Capped so a short range (or a heavily bucketed one) doesn't render a handful of slab-wide bars. */}
                <Bar
                  dataKey="outputTokens"
                  name="output"
                  stackId="tokens"
                  fill="url(#blueBar)"
                  radius={[2, 2, 2, 2]}
                  maxBarSize={44}
                />
                <Bar
                  dataKey="inputTokens"
                  name="input"
                  stackId="tokens"
                  fill="url(#hatchGray)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GraphShell>
      </div>

      <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <GraphShell
          title="Job Health"
          icon={<ShieldCheck size={14} strokeWidth={2} />}
        >
          <div className="flex flex-1 items-center gap-5 px-3.5 py-4 sm:px-4 sm:py-4.5">
            <div className="relative h-36 w-36 shrink-0">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={0}
              >
                <PieChart>
                  <Pie
                    data={stats.statuses}
                    dataKey="count"
                    nameKey="status"
                    innerRadius="72%"
                    outerRadius="96%"
                    paddingAngle={3}
                    cornerRadius={4}
                    strokeWidth={0}
                    isAnimationActive
                  >
                    {stats.statuses.map((s) => (
                      <Cell
                        key={s.status}
                        fill={STATUS_COLOR[s.status] ?? quietColor}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="ui-font-mono text-xl font-medium leading-none text-ui-strong">
                  {formatCompact(statusTotal)}
                </span>
                <span className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ui-subtle">
                  Jobs
                </span>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-2.5">
              {stats.statuses.map((s) => (
                <div
                  key={s.status}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{
                        backgroundColor: STATUS_COLOR[s.status] ?? quietColor,
                      }}
                    />
                    <span className="truncate text-[13px] font-medium capitalize text-ui-default">
                      {s.status}
                    </span>
                  </span>
                  <span className="ui-font-mono shrink-0 text-xs tabular-nums text-ui-subtle">
                    {s.count}
                    <span className="text-ui-subtle/70">
                      {" "}
                      ({Math.round((s.count / statusTotal) * 100)}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </GraphShell>

        <GraphShell
          title="Top Repositories"
          icon={<FolderGit2 size={14} strokeWidth={2} />}
        >
          <MeterList visible={4}>
            {stats.topRepos.map((repo, i) => (
              <TickMeter
                key={`${repo.owner}/${repo.repo}`}
                label={repo.repo}
                value={repo.jobs}
                max={repoMax}
                color={tickColors[i % tickColors.length]}
                valueLabel={repo.jobs.toLocaleString()}
              />
            ))}
          </MeterList>
        </GraphShell>

        <GraphShell
          title="Model Calls"
          icon={<Boxes size={14} strokeWidth={2} />}
        >
          <MeterList visible={5}>
            {stats.models.map((model, i) => (
              <TickMeter
                key={model.modelUsed}
                label={modelName(model.modelUsed)}
                value={model.calls}
                max={modelMax}
                color={tickColors[i % tickColors.length]}
                valueLabel={model.calls.toLocaleString()}
              />
            ))}
          </MeterList>
        </GraphShell>
      </div>
    </>
  );
}
