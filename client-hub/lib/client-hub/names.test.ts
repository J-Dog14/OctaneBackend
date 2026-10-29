import { describe, expect, test } from 'vitest';
import { canonicalName, findByName } from './names';

describe('names', () => {
  test('should strip sheet notes and expand nicknames', () => {
    expect(canonicalName('Zach Davis (remote) **new**')).toBe('zachary davis');
    expect(canonicalName('Will Smith PAUSED until Jan')).toBe('william smith');
    expect(canonicalName('Drew')).toBe('drew'); // no last name → no expansion
  });
  test('should prefer exact matches over fuzzy ones', () => {
    const list = [{ n: 'Jaslina Suarez' }, { n: 'Jasline Suarez' }];
    expect(findByName('Jaslina Suarez', list, (x) => x.n)).toEqual([{ n: 'Jaslina Suarez' }]);
  });
  test('should allow two typos on names of 8+ characters only', () => {
    const list = [{ n: 'Andrew Mullis' }, { n: 'Bo Li' }];
    expect(findByName('Andrew Mulis', list, (x) => x.n)).toEqual([{ n: 'Andrew Mullis' }]);
    expect(findByName('Bo Lu', list, (x) => x.n)).toEqual([]);
  });
});
