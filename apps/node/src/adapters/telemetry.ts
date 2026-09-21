import type { TelemetrySink } from '@codraoss/core/ports';
import type { NodeAppBindings } from '../env';

export function makeTelemetrySink(_env: NodeAppBindings): TelemetrySink {
  return { 
    send: async (_event) => {
      // In a real setup this would batch and send to a telemetry endpoint
      // For now, in Node open-source, telemetry can be safely stubbed or sent to logs
    } 
  };
}
