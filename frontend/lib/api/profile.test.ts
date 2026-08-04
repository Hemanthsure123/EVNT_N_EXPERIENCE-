import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_AVATAR_TYPES,
  AVATAR_ACCEPT,
  AVATAR_MAX_BYTES,
  avatarUrlOf,
  checkAvatarFile,
  resolveMediaUrl,
  type ProfileUser,
} from './profile';

/**
 * These are the checks that MIRROR `backend/core/uploads.validate_image`, and
 * the point of pinning them is that a mirror drifts. The server refuses an empty
 * file, then one over 10 MB, then a type outside its allow-list — in that order
 * — and it is the authority. This copy exists only so an ordinary mistake costs
 * no round trip, which means its messages have to be the SAME messages: two
 * different explanations for one file is how somebody concludes the limit is
 * arbitrary.
 *
 * The one rule it cannot mirror is the leading-byte check (a browser cannot read
 * the bytes before uploading them), which is why nothing here treats a `null`
 * result as permission — it means "no reason to refuse it locally".
 */

/** A file of an arbitrary declared size, without allocating the bytes. */
function fileOf({ type, size = 1024, name = 'photo.png' }: {
  type: string;
  size?: number;
  name?: string;
}): File {
  const file = new File(['x'], name, { type });
  // `size` is read-only on File, and allocating 10 MB per case to test a
  // comparison would make this suite slow for nothing.
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('checkAvatarFile', () => {
  it('accepts every type on the server allow-list', () => {
    for (const type of ACCEPTED_AVATAR_TYPES) {
      expect(checkAvatarFile(fileOf({ type })), type).toBeNull();
    }
  });

  it('refuses an empty file', () => {
    expect(checkAvatarFile(fileOf({ type: 'image/png', size: 0 }))).toBe('That file is empty.');
  });

  it('refuses one over the cap, and says how big it actually is', () => {
    const problem = checkAvatarFile(fileOf({ type: 'image/jpeg', size: 14.2 * 1024 * 1024 }));

    // "that image is 14.2 MB, the limit is 10 MB" is actionable; "invalid
    // upload" is not — the same standard `core.uploads` holds itself to.
    expect(problem).toContain('14.2 MB');
    expect(problem).toContain('10 MB');
  });

  it('allows a file exactly at the cap — the server compares with >', () => {
    expect(checkAvatarFile(fileOf({ type: 'image/png', size: AVATAR_MAX_BYTES }))).toBeNull();
    expect(checkAvatarFile(fileOf({ type: 'image/png', size: AVATAR_MAX_BYTES + 1 }))).not.toBeNull();
  });

  it('refuses SVG, and names the reason rather than just refusing', () => {
    const problem = checkAvatarFile(fileOf({ type: 'image/svg+xml', name: 'logo.svg' }));

    // An SVG IS an image everywhere else on the web, so a bare "not supported"
    // reads as a bug and invites somebody to add it to the allow-list.
    // `ProfileService.set_avatar` explains it: an avatar is the most widely
    // rendered user-supplied image on the platform, and an SVG is a document
    // that can carry script — serving one from our own origin is stored XSS.
    expect(problem).toMatch(/SVG/);
    expect(problem).toMatch(/code/);
  });

  it('never offers SVG in the file picker either', () => {
    expect(AVATAR_ACCEPT).not.toContain('svg');
    expect(AVATAR_ACCEPT.split(',')).toEqual(ACCEPTED_AVATAR_TYPES);
  });

  it('refuses a type that is not an image at all', () => {
    expect(checkAvatarFile(fileOf({ type: 'application/pdf', name: 'ticket.pdf' }))).toContain(
      'not supported',
    );
  });

  it('refuses an image type the server does not accept', () => {
    // A real one: cameras and scanners still emit TIFF, and no browser renders
    // it — so it is refused here for the same reason the server refuses it.
    expect(checkAvatarFile(fileOf({ type: 'image/tiff', name: 'scan.tif' }))).toContain(
      'not supported',
    );
  });

  it('refuses a file the picker could not type, rather than sending it hopefully', () => {
    // Some file managers hand over an empty `type`. The server would reject it
    // on the declared content type anyway; failing here saves the bytes.
    expect(checkAvatarFile(fileOf({ type: '', name: 'photo' }))).toContain('not supported');
  });

  it('checks size before type, exactly as the server does', () => {
    // Both wrong: the message must be the one the SERVER would have given, or a
    // user who fixes the type discovers the size problem on the second attempt.
    const problem = checkAvatarFile(fileOf({ type: 'application/pdf', size: 20 * 1024 * 1024 }));

    expect(problem).toContain('MB');
  });
});

describe('resolveMediaUrl', () => {
  it('is empty for no picture, in every shape the field can arrive in', () => {
    expect(resolveMediaUrl('')).toBe('');
    expect(resolveMediaUrl(null)).toBe('');
    expect(resolveMediaUrl(undefined)).toBe('');
  });

  it('resolves a root-relative /media path against the API origin', () => {
    // `LocalStorageAdapter` (STORAGE_BACKEND=local) returns `/media/...`, which
    // a browser would resolve against the SITE origin — so with the API on
    // another origin every avatar would 404 against Next.
    expect(resolveMediaUrl('/media/avatars/abc/def.png')).toBe(
      'http://localhost:8000/media/avatars/abc/def.png',
    );
  });

  it('adds the missing separator rather than concatenating blindly', () => {
    expect(resolveMediaUrl('media/avatars/a.png')).toBe('http://localhost:8000/media/avatars/a.png');
  });

  it('passes an absolute URL through untouched', () => {
    // S3/R2/Supabase adapters publish a full URL. Rewriting it would break
    // exactly the deployments that work.
    expect(resolveMediaUrl('https://bucket.example.com/avatars/a.png')).toBe(
      'https://bucket.example.com/avatars/a.png',
    );
    expect(resolveMediaUrl('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
  });
});

describe('avatarUrlOf', () => {
  // Cast rather than a full `User`: this reads exactly one field, and building
  // the whole identity record here would couple the test to fields it ignores.
  const profileWith = (avatar_url?: string) => ({ avatar_url }) as ProfileUser;

  it('is empty when there is nobody signed in', () => {
    expect(avatarUrlOf(null)).toBe('');
    expect(avatarUrlOf(undefined)).toBe('');
  });

  it("is empty for the column's own 'no picture' value", () => {
    expect(avatarUrlOf(profileWith(''))).toBe('');
  });

  it('is the resolved URL when there is a picture', () => {
    expect(avatarUrlOf(profileWith('/media/avatars/abc/def.png'))).toBe(
      'http://localhost:8000/media/avatars/abc/def.png',
    );
  });
});
