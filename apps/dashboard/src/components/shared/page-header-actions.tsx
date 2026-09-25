import { Button } from "@codraoss/ui";
import { RefreshCw } from "lucide-react";
import { TimeRangeSelect } from "@client/components/features/stats/time-range-select";

interface PageHeaderActionsProps {
  days: number;
  onDaysChange: (days: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function PageHeaderActions({
  days,
  onDaysChange,
  onRefresh,
  refreshing,
}: PageHeaderActionsProps) {
  return (
    <>
      <TimeRangeSelect value={days} onValueChange={onDaysChange} />
      <Button
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        icon={
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
        }
      >
        Refresh
      </Button>
    </>
  );
}
