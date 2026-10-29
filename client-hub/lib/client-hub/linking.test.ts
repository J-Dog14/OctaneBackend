import { describe, expect, test } from 'vitest';
import { athlete, client, ME, OTHER } from './fixtures';
import { chooseAutoLink, planSeed } from './linking';

describe('chooseAutoLink', () => {
  test('should link a single exact match, nickname-aware', () => {
    const list = [athlete('a1', 'Zachary Davis', [{}])];
    expect(chooseAutoLink(client({ name: 'Zach Davis' }), list, null)?.uuid).toBe('a1');
  });
  test('should not link on a fuzzy match', () => {
    expect(chooseAutoLink(client({ name: 'Zachary Davies' }), [athlete('a1', 'Zachary Davis')], null)).toBeNull();
  });
  test('should break ties by my coaching, then program count, and skip true ties', () => {
    const mine = athlete('mine', 'Sam Lee', [{ coaches: [{ userUuid: ME, name: 'Me' }] }]);
    const theirs = athlete('theirs', 'Sam Lee', [{ coaches: [{ userUuid: OTHER, name: 'Max' }] }]);
    expect(chooseAutoLink(client({ name: 'Sam Lee' }), [theirs, mine], ME)?.uuid).toBe('mine');
    expect(chooseAutoLink(client({ name: 'Sam Lee' }), [theirs, mine], null)).toBeNull();
  });
  test('should leave linked, ended and dismissed clients alone', () => {
    const list = [athlete('a1', 'Thomas Greer')];
    expect(chooseAutoLink(client({ linkSource: 'DISMISSED' }), list, null)).toBeNull();
    expect(chooseAutoLink(client({ status: 'ENDED' }), list, null)).toBeNull();
    expect(chooseAutoLink(client({ octaneAthleteUuid: 'x' }), list, null)).toBeNull();
  });
});

describe('planSeed', () => {
  test('should add remote and hybrid athletes not already in the hub, owned by a mapped coach', () => {
    const athletes = [
      athlete('r1', 'Andrew Mullis', [{ type: 'REMOTE', coaches: [{ userUuid: ME, name: 'Ryan Chasse' }] }]),
      athlete('h1', 'Hy Brid', [{ type: 'HYBRID' }]),
      athlete('i1', 'In House', [{ type: 'IN_HOUSE' }]),
      athlete('dup', 'Thomas Greer', [{ type: 'REMOTE' }]),
      athlete('none', 'No Program'),
    ];
    const plan = planSeed(athletes, [client({ name: 'Tom Greer' })], [{ clerkUserId: 'user_ryan', octaneUserUuid: ME }]);
    expect(plan.map((p) => [p.octaneAthleteUuid, p.programType, p.ownerClerkUserId])).toEqual([
      ['r1', 'REMOTE', 'user_ryan'],
      ['h1', 'HYBRID', null],
    ]);
  });
});
