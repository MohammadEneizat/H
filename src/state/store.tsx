import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { StudyInput } from '../engine';
import { defaultStudy, runStudy, type StudyResult } from '../engine';

const STORAGE_KEY = 'spp-grounding-study-v1';

type Action =
  | { type: 'patch'; patch: Partial<StudyInput> }
  | { type: 'replace'; study: StudyInput }
  | { type: 'reset' };

function reducer(state: StudyInput, action: Action): StudyInput {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'replace':
      return action.study;
    case 'reset':
      return defaultStudy();
    default:
      return state;
  }
}

function loadInitial(): StudyInput {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultStudy();
    const parsed = JSON.parse(raw) as Partial<StudyInput>;
    // Merge over the defaults so a study saved by an older build still opens.
    const base = defaultStudy();
    return {
      ...base,
      ...parsed,
      meta: { ...base.meta, ...parsed.meta },
      grid: { ...base.grid, ...parsed.grid },
      auxiliary: { ...base.auxiliary, ...parsed.auxiliary },
      sizing: { ...base.sizing, ...parsed.sizing },
      fence: { ...base.fence, ...parsed.fence },
      regions: parsed.regions?.length ? parsed.regions : base.regions,
      traverses: parsed.traverses ?? base.traverses,
    };
  } catch {
    return defaultStudy();
  }
}

interface StoreValue {
  study: StudyInput;
  result: StudyResult;
  patch: (patch: Partial<StudyInput>) => void;
  replace: (study: StudyInput) => void;
  reset: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [study, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(study));
    } catch {
      // Storage can be unavailable (private windows, blocked site data). The study still works.
    }
  }, [study]);

  const result = useMemo(() => {
    try {
      return runStudy(study);
    } catch {
      return runStudy(defaultStudy());
    }
  }, [study]);

  const value = useMemo<StoreValue>(
    () => ({
      study,
      result,
      patch: (patch) => dispatch({ type: 'patch', patch }),
      replace: (s) => dispatch({ type: 'replace', study: s }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [study, result],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStudy(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStudy must be used inside a StoreProvider');
  return ctx;
}
