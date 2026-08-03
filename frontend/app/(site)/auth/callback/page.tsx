import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GoogleCallback, GoogleCallbackPending } from '@/components/auth/google-callback';

export const metadata: Metadata = {
  title: 'Signing you in…',
  // A transient handoff page. Indexing it would put a URL in search results
  // that does nothing useful when visited directly.
  robots: { index: false, follow: false },
};

export default function AuthCallbackPage() {
  return (
    // `useSearchParams` needs a Suspense boundary to prerender. The fallback is
    // the same shell the client renders, so the transition is invisible.
    <Suspense fallback={<GoogleCallbackPending />}>
      <GoogleCallback />
    </Suspense>
  );
}
