export type Throttle = { request(): void; cancel(): void };

/**
 * Runs `run` at most once per intervalMs and never twice at the same time. Any
 * number of requests while waiting or running lead to exactly one more run.
 */
export function createThrottle(
  run: () => Promise<void>,
  intervalMs: number,
  onError: (e: unknown) => void,
): Throttle {
  let lastStart = -Infinity;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    timer = null;
    pending = false;
    running = true;
    lastStart = Date.now();
    run()
      .catch(onError)
      .finally(() => {
        running = false;
        if (pending) schedule();
      });
  };

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(start, Math.max(0, lastStart + intervalMs - Date.now()));
  };

  return {
    request() {
      if (running) pending = true;
      else schedule();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
