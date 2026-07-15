/**
 * @patchback/react — a THIN lifecycle wrapper over the vanilla widget.
 *
 * One UI implementation exists: the vanilla one. This package only manages
 * creation/teardown from React's lifecycle and exposes hooks. No portals
 * into the shadow root, no parallel component tree, no react-dom
 * dependency — the widget renders itself into its own host.
 *
 * SSR-safe (creation strictly inside useEffect) and StrictMode-safe (the
 * vanilla destroy() fully tears down; double-mount is exercised in tests).
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  createPatchbackWidget,
  type PatchbackWidget,
  type PatchbackWidgetConfig,
} from '@patchback/widget';
import type { JobState } from '@patchback/types';

const PatchbackContext = createContext<PatchbackWidget | null>(null);

export interface PatchbackProviderProps {
  /**
   * Widget configuration. Compared by IDENTITY: a new object recreates the
   * widget — memoize it (or hoist it to module scope) in the embedding
   * app.
   */
  config: PatchbackWidgetConfig;
  children?: ReactNode;
}

export function PatchbackProvider(
  props: PatchbackProviderProps,
): ReactNode {
  const [widget, setWidget] = useState<PatchbackWidget | null>(null);

  useEffect(() => {
    const instance = createPatchbackWidget(props.config);
    setWidget(instance);
    return () => {
      instance.destroy();
      setWidget(null);
    };
  }, [props.config]);

  return (
    <PatchbackContext.Provider value={widget}>
      {props.children}
    </PatchbackContext.Provider>
  );
}

/**
 * The widget controller (open/close/toggle/pickElement/on), or null before
 * the effect has run (including during SSR).
 */
export function usePatchback(): PatchbackWidget | null {
  return useContext(PatchbackContext);
}

export interface PatchbackStatus {
  jobId: string;
  state: JobState;
}

/** Re-renders on every job status change; null until the first event. */
export function usePatchbackStatus(): PatchbackStatus | null {
  const widget = usePatchback();
  const [status, setStatus] = useState<PatchbackStatus | null>(null);

  useEffect(() => {
    if (widget === null) {
      return;
    }
    return widget.on('statusChange', (event) => {
      setStatus({ jobId: event.jobId, state: event.state as JobState });
    });
  }, [widget]);

  return status;
}

export interface PatchbackLauncherProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Optional custom launcher: configure the widget with `launcher: false`
 * and render your own button anywhere in the tree.
 */
export function PatchbackLauncher(props: PatchbackLauncherProps): ReactNode {
  const widget = usePatchback();
  return (
    <button
      type="button"
      {...(props.className !== undefined
        ? { className: props.className }
        : {})}
      onClick={() => widget?.toggle()}
      disabled={widget === null}
    >
      {props.children ?? 'Send feedback'}
    </button>
  );
}

export type { PatchbackWidget, PatchbackWidgetConfig } from '@patchback/widget';
