import { api } from './client';
import { ApiError } from './errors';

/**
 * Organizations — the supply side of the ticketing product.
 *
 * An organization is owned by a USER, and a user may own several. There is no
 * "organizer account type": becoming an organizer is creating an organization
 * on the account you already have, which is why this lives under `/account`
 * and not behind a second sign-up.
 */

export type VerifiedLevel = 'unverified' | 'pending' | 'verified';

export type Organization = {
  id: string;
  owner_id: string;
  name: string;
  verified_level: VerifiedLevel;
  payout_account_id: string;
  logo_url: string;
  created_at: string;
};

export type VerificationRecord = {
  id: string;
  organization_id: string;
  status: 'pending' | 'approved' | 'rejected';
  /** The operator's note. On a rejection this is the REASON, and it is the
      only thing that tells an organizer what to fix. */
  notes: string;
  created_at: string;
  processed_at: string | null;
};

/**
 * Create one.
 *
 * `multipart` because the endpoint accepts an optional logo file, and the
 * client passes `FormData` straight through — setting `Content-Type` by hand
 * omits the boundary and the server then finds no parts at all.
 */
export function createOrganization(input: { name: string; logo?: File | null }) {
  const form = new FormData();
  form.append('name', input.name);
  if (input.logo) form.append('logo', input.logo);
  return api.post<Organization>('/organizations/', form);
}

export const submitVerification = (organizationId: string, notes: string) =>
  api.post<VerificationRecord>(
    `/organizations/${encodeURIComponent(organizationId)}/verification`,
    { notes },
  );

/**
 * Where verification stands.
 *
 * **404 is a normal answer**, not a failure: it means nothing has been
 * submitted yet, which is what a brand-new organization looks like. The
 * caller renders the submit form for it. Anything else is a real error and
 * is rethrown, because "we could not reach the server" and "you have not
 * applied yet" must not look the same on screen.
 */
export async function fetchVerification(organizationId: string): Promise<VerificationRecord | null> {
  try {
    return await api.get<VerificationRecord>(
      `/organizations/${encodeURIComponent(organizationId)}/verification`,
    );
  } catch (thrown) {
    if (thrown instanceof ApiError && thrown.status === 404) return null;
    throw thrown;
  }
}
