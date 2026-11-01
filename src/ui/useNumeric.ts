import { useEffect, useRef, useState } from 'react';
import {
  bodyLosses,
  numericField,
  numericRating,
  type CableSpec,
  type InstallationSpec,
  type NumericResult,
  type RatingResult,
} from '../engine';
import NumericWorker from '../engine/numeric.worker?worker&inline';

export interface NumericData {
  result: RatingResult;
  numeric: NumericResult;
  field: (x: number, y: number) => number;
  /** Inputs the result belongs to */
  key: string;
}

export interface NumericState {
  status: 'off' | 'running' | 'ready' | 'error';
  data: NumericData | null;
  /** True when data matches the current inputs */
  fresh: boolean;
  error?: string;
}

const fieldFor = (inst: InstallationSpec, result: RatingResult, numeric: NumericResult) =>
  numericField(numeric, bodyLosses(inst, result), inst.ambient_C);

/** Set once a worker fails to start (for example when the page does not allow workers). */
let workerBlocked = false;

/** Runs the numerical ground model for a trench layout, after the inputs have settled. */
export function useNumeric(cable: CableSpec, inst: InstallationSpec, iec: RatingResult): NumericState {
  const enabled = inst.type === 'trench' && !!inst.trench && iec.ok;
  const key = enabled ? JSON.stringify([cable, inst]) : '';
  const [state, setState] = useState<NumericState>({ status: 'off', data: null, fresh: false });
  const worker = useRef<Worker | null>(null);
  const job = useRef(0);

  useEffect(() => () => worker.current?.terminate(), []);

  useEffect(() => {
    if (!enabled) {
      setState((s) => (s.status === 'off' ? s : { status: 'off', data: s.data, fresh: false }));
      return;
    }
    setState((s) => ({ ...s, status: 'running', fresh: s.data?.key === key }));
    const id = ++job.current;
    const timer = window.setTimeout(() => {
      const done = (result: RatingResult, numeric: NumericResult) => {
        if (id !== job.current) return;
        setState({
          status: result.ok ? 'ready' : 'error',
          data: { result, numeric, field: fieldFor(inst, result, numeric), key },
          fresh: true,
          error: result.ok ? undefined : result.errors[0],
        });
      };
      const fail = (msg: string) => {
        if (id === job.current) setState((s) => ({ ...s, status: 'error', fresh: false, error: msg }));
      };
      const inPage = () => {
        try {
          const out = numericRating(cable, inst, iec);
          if (out) done(out.result, out.numeric);
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err));
        }
      };
      try {
        if (!worker.current && !workerBlocked && typeof Worker !== 'undefined') worker.current = new NumericWorker();
      } catch {
        worker.current = null;
        workerBlocked = true;
      }
      if (worker.current) {
        worker.current.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.id !== job.current) return;
          if (m.ok) done(m.result, m.numeric);
          else fail(m.error);
        };
        worker.current.onerror = (e) => {
          e.preventDefault?.();
          // The page may not allow workers: run in the page from now on
          worker.current?.terminate();
          worker.current = null;
          workerBlocked = true;
          if (id === job.current) window.setTimeout(inPage, 0);
        };
        worker.current.postMessage({ id, cable, inst, iec });
      } else {
        inPage();
      }
    }, 350);
    return () => window.clearTimeout(timer);
    // key covers cable and inst
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { ...state, fresh: !!state.data && state.data.key === key };
}
