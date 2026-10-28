import { slowerBucket, speedBucket } from './buckets';

test.each([
  [0, 'walk'],
  [8, 'walk'],
  [8.1, 'cycle'],
  [25, 'cycle'],
  [25.1, 'vehicle'],
  [120, 'vehicle'],
] as const)('speedBucket(%p) is %p', (kmh, bucket) => {
  expect(speedBucket(kmh)).toBe(bucket);
});

test('slowerBucket keeps the slower mode', () => {
  expect(slowerBucket('vehicle', 'walk')).toBe('walk');
  expect(slowerBucket('cycle', 'vehicle')).toBe('cycle');
  expect(slowerBucket('walk', 'cycle')).toBe('walk');
  expect(slowerBucket('vehicle', 'vehicle')).toBe('vehicle');
});
