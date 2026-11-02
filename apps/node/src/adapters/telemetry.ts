import type { TelemetrySink } from "@codraoss/core/ports";
import type { NodeAppBindings } from "../env";

export function makeTelemetrySink(_env: NodeAppBindings): TelemetrySink {
  return {
    send: async (_event) => {
      // Telemetry stubbed in Node open-source.
    },
  };
}
