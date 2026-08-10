import { describe, expect, it } from 'vitest';

import { adminQueryKeys } from './query-keys';

/**
 * The bug these guard against did not throw and did not log. The pending
 * moderation queue simply rendered as EMPTY — an operator reads "nothing to
 * review" while an organizer's event waits — because a `useQuery` and a
 * `useInfiniteQuery` shared one cache entry and therefore one data shape.
 *
 * A key collision is invisible by inspection, so it gets a test.
 */
describe('adminQueryKeys', () => {
  it('never gives the count probe and the paginated queue the same key', () => {
    for (const status of ['pending_review', 'live', 'rejected', 'archived'] as const) {
      expect(adminQueryKeys.moderationCount(status)).not.toEqual(
        adminQueryKeys.moderationQueue(status),
      );
    }
  });

  it('keeps both under the prefixes the invalidation calls use', () => {
    // `invalidateQueries({ queryKey: ['admin'] })` after a decision, and
    // `['admin', 'moderation']` after a failed one. Both must still match, or
    // deciding an event leaves the list showing the row it just removed.
    for (const key of [
      adminQueryKeys.moderationCount('pending_review'),
      adminQueryKeys.moderationQueue('pending_review'),
    ]) {
      expect(key.slice(0, 2)).toEqual(['admin', 'moderation']);
    }
  });

  it('separates statuses, so switching tabs is not one shared entry', () => {
    expect(adminQueryKeys.moderationQueue('pending_review')).not.toEqual(
      adminQueryKeys.moderationQueue('rejected'),
    );
  });
});
