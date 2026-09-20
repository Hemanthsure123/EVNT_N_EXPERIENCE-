import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every payment gateway the checkout can open must be allowed by `form-action`.
 *
 * ── THE BUG THIS PINS ────────────────────────────────────────────────────
 *
 * Cashfree's SDK builds a `<form>` in OUR document — `createForm` in
 * cashfree.js, with `action` set to a Cashfree URL and `target` set to its
 * modal iframe — and submits it. The CSP listed only `'self'` and Razorpay, so
 * the browser refused the submit. The SDK had already appended
 * `#cashfree-modal-container` and only removes it in `_closeIframeModal`,
 * which never ran because the iframe never loaded.
 *
 * What the customer saw was the entire application dimmed and unresponsive —
 * on the checkout, and on every screen afterwards, because that container is a
 * child of `<body>` that React never owned. Nothing about it mentioned
 * payments, or CSP. Razorpay worked throughout, which made it look like a
 * Cashfree integration bug rather than a header.
 *
 * This reads the real config rather than a copy: a test asserting against a
 * duplicated string would pass while production was broken.
 */

const CONFIG = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

const formAction = (): string => {
  const match = CONFIG.match(/"form-action ([^"]+)"/);
  if (!match) throw new Error('no form-action directive found in next.config.mjs');
  return match[1];
};

describe('the payment CSP', () => {
  it('allows Cashfree to submit its checkout form', () => {
    expect(formAction()).toContain('cashfree.com');
  });

  it('still allows Razorpay, which had the same requirement first', () => {
    const value = formAction();
    expect(value).toContain('checkout.razorpay.com');
    expect(value).toContain('api.razorpay.com');
  });

  it('keeps self, which the funnel posts to', () => {
    expect(formAction()).toContain("'self'");
  });

  it('does not open form-action to everything', () => {
    // The directive exists to stop a stored `<base>` or an injected form
    // posting somewhere else. A bare `*` would make it decorative.
    const value = formAction();
    expect(value.split(/\s+/)).not.toContain('*');
  });

  it('still blocks framing and plugin embedding', () => {
    // The clickjacking protections this header block was added for. A change
    // that only widened form-action must not have weakened these.
    expect(CONFIG).toContain("frame-ancestors 'none'");
    expect(CONFIG).toContain("object-src 'none'");
    expect(CONFIG).toContain("base-uri 'self'");
  });
});
