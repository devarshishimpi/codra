import { useMemo } from 'react';
import { cn } from '../lib/utils';

interface BarSparklineProps {
  data: number[];
  color: string;
  bars?: number;
  className?: string;
}

// Resamples data to exactly bars values (summed down or nearest-neighbour stretched up).
function bucketize(data: number[], bars: number): number[] {
  const out = Array<number>(bars).fill(0);
  if (data.length === 0) return out;

  if (data.length >= bars) {
    const size = data.length / bars;
    for (let i = 0; i < bars; i++) {
      const start = Math.floor(i * size);
      const end = Math.floor((i + 1) * size);
      out[i] = data.slice(start, end).reduce((sum, v) => sum + v, 0);
    }
  } else {
    for (let i = 0; i < bars; i++) {
      out[i] = data[Math.floor((i * data.length) / bars)];
    }
  }
  return out;
}

const BASELINE_PCT = 32;

export function BarSparkline({ data, color, bars = 8, className }: BarSparklineProps) {
  const buckets = useMemo(() => bucketize(data, bars), [data, bars]);
  const max = Math.max(...buckets, 1);

  return (
    <div className={cn('flex h-12 items-end justify-end gap-[3px]', className)} aria-hidden="true">
      {buckets.map((value, i) => (
        <div
          key={i}
          className="w-[5px] rounded-[2px] transition-[height] duration-500"
          style={{
            height: `${BASELINE_PCT + (value / max) * (100 - BASELINE_PCT)}%`,
            background: `linear-gradient(to top, ${color}99, ${color})`,
          }}
        />
      ))}
    </div>
  );
}
