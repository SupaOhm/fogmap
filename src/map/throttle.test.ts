import { createThrottle } from './throttle';

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

function counter(durationMs = 0) {
  const calls = { started: 0 };
  const run = () =>
    new Promise<void>((resolve) => {
      calls.started++;
      setTimeout(resolve, durationMs);
    });
  return { calls, run };
}

test('the first request runs on the next tick', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  expect(calls.started).toBe(0);
  await jest.advanceTimersByTimeAsync(0);
  expect(calls.started).toBe(1);
});

test('requests within the interval collapse into one trailing run', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  t.request();
  t.request();
  t.request();
  await jest.advanceTimersByTimeAsync(1999);
  expect(calls.started).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(calls.started).toBe(2);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(calls.started).toBe(2);
});

test('a request during a run waits for it to finish, then runs once more', async () => {
  const { calls, run } = counter(5000);
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  t.request();
  t.request();
  await jest.advanceTimersByTimeAsync(4999);
  expect(calls.started).toBe(1);
  await jest.advanceTimersByTimeAsync(1);
  // The follow-up is scheduled while the clock is ticking, and fake timers push a 0 ms timer set
  // mid-tick to the next millisecond.
  await jest.advanceTimersByTimeAsync(1);
  expect(calls.started).toBe(2);
});

test('cancel drops a scheduled run', async () => {
  const { calls, run } = counter();
  const t = createThrottle(run, 2000, jest.fn());
  t.request();
  t.cancel();
  await jest.advanceTimersByTimeAsync(5000);
  expect(calls.started).toBe(0);
});

test('a failed run is reported and later requests still run', async () => {
  const onError = jest.fn();
  let n = 0;
  const t = createThrottle(
    async () => {
      n++;
      if (n === 1) throw new Error('boom');
    },
    2000,
    onError,
  );
  t.request();
  await jest.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledWith(new Error('boom'));
  t.request();
  await jest.advanceTimersByTimeAsync(2000);
  expect(n).toBe(2);
});
