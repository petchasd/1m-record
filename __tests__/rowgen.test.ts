/**
 * The seed script and the app's "random email" shortcut both derive a row
 * from its id independently — if that derivation ever became non-deterministic
 * or id-dependent-on-neighbours, the two would silently drift apart.
 */

import { emailForId, makeProfile } from '../src/db/rowgen';

describe('emailForId', () => {
  it('is a pure function of id', () => {
    expect(emailForId(500000)).toBe(emailForId(500000));
  });

  it('is unique per id', () => {
    expect(emailForId(1)).not.toBe(emailForId(2));
  });
});

describe('makeProfile', () => {
  it('is deterministic for a given id', () => {
    expect(makeProfile(42)).toEqual(makeProfile(42));
  });

  it('embeds emailForId(id) as the email field', () => {
    const [, email] = makeProfile(123);
    expect(email).toBe(emailForId(123));
  });

  it('produces different rows for different ids', () => {
    expect(makeProfile(1)).not.toEqual(makeProfile(2));
  });
});
