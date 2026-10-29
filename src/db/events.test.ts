import { type CellsChange, emitCellsChanged, onCellsChanged } from './events';

test('listeners hear changes until they unsubscribe', () => {
  const heard: string[] = [];
  const offA = onCellsChanged(() => heard.push('a'));
  const offB = onCellsChanged(() => heard.push('b'));
  emitCellsChanged();
  offA();
  emitCellsChanged();
  offB();
  emitCellsChanged();
  expect(heard).toEqual(['a', 'b', 'b']);
});

test('a listener that unsubscribes while being called does not break the others', () => {
  const heard: string[] = [];
  const off = onCellsChanged(() => {
    heard.push('once');
    off();
  });
  const offOther = onCellsChanged(() => heard.push('other'));
  emitCellsChanged();
  emitCellsChanged();
  offOther();
  expect(heard).toEqual(['once', 'other', 'other']);
});

test('listeners get the kind of change, added by default', () => {
  const heard: CellsChange[] = [];
  const off = onCellsChanged((change) => heard.push(change));
  emitCellsChanged();
  emitCellsChanged('reset');
  off();
  expect(heard).toEqual(['added', 'reset']);
});

test('a throwing listener does not stop the others; the first error is rethrown', () => {
  const heard: string[] = [];
  const first = new Error('first');
  const offA = onCellsChanged(() => {
    throw first;
  });
  const offB = onCellsChanged(() => {
    heard.push('b');
    throw new Error('second');
  });
  const offC = onCellsChanged(() => heard.push('c'));
  expect(() => emitCellsChanged()).toThrow(first);
  offA();
  offB();
  offC();
  expect(heard).toEqual(['b', 'c']);
});
