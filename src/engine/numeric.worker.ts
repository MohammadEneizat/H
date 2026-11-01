// Runs the numerical ground model off the main thread.
import { numericRating } from './numericRating';
import type { CableSpec, InstallationSpec, RatingResult } from './types';

interface Job {
  id: number;
  cable: CableSpec;
  inst: InstallationSpec;
  iec: RatingResult;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, cable, inst, iec } = e.data;
  try {
    const out = numericRating(cable, inst, iec);
    if (!out) {
      self.postMessage({ id, ok: false, error: 'Not a trench layout.' });
      return;
    }
    self.postMessage({ id, ok: true, result: out.result, numeric: out.numeric });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
