import { afterEach, describe, expect, it } from 'vitest';
import { dismissCashfreeOverlay } from './cashfree';

/**
 * The bug this pins, which took the whole application down rather than just a
 * payment.
 *
 * Cashfree's SDK appends `#cashfree-modal-container` to `<body>` and sets
 * `overflow: hidden !important` on it, then undoes both in `_closeIframeModal`
 * — which only runs when the modal CLOSES. A modal that never opened never
 * closes, so a blocked form submit (our own CSP, as it turned out), a refused
 * session or a dropped network left that container on the page.
 *
 * It is a full-screen overlay outside React's tree, so it survived every
 * client-side navigation: the customer saw every screen dimmed and
 * unresponsive, on the checkout and everywhere they went afterwards, until
 * they hard-refreshed. Far worse than the payment failing, and entirely ours
 * to prevent — we cannot patch the SDK, but we can refuse to leave its
 * wreckage on the page.
 */

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.removeProperty('overflow');
  document.documentElement.style.removeProperty('overflow');
});

const plantSdkModal = () => {
  const container = document.createElement('div');
  container.id = 'cashfree-modal-container';
  container.innerHTML = '<iframe id="cashfree-modal-iframe"></iframe>';
  document.body.appendChild(container);
  // Exactly what the SDK does on the iframe's `onload`.
  document.body.style.setProperty('overflow', 'hidden', 'important');
};

describe('dismissCashfreeOverlay', () => {
  it('removes the container the SDK left behind', () => {
    plantSdkModal();
    expect(document.getElementById('cashfree-modal-container')).not.toBeNull();

    dismissCashfreeOverlay();

    expect(document.getElementById('cashfree-modal-container')).toBeNull();
  });

  it('restores scrolling, which the SDK sets with !important', () => {
    // The reason this uses `removeProperty` rather than assigning '': an
    // `!important` declaration is not overwritten by a normal assignment, so
    // the page would stay unscrollable.
    plantSdkModal();
    expect(document.body.style.overflow).toBe('hidden');

    dismissCashfreeOverlay();

    expect(document.body.style.overflow).toBe('');
  });

  it('also clears the atom container the SDK can leave', () => {
    const atom = document.createElement('div');
    atom.id = 'cashfreePrivateAtomDiv';
    document.body.appendChild(atom);

    dismissCashfreeOverlay();

    expect(document.getElementById('cashfreePrivateAtomDiv')).toBeNull();
  });

  it('is safe to call when the SDK never ran', () => {
    // It runs after EVERY attempt, including ones that failed before the SDK
    // loaded at all, so a bare page must not throw.
    expect(() => dismissCashfreeOverlay()).not.toThrow();
  });

  it('is idempotent — calling it twice is a no-op', () => {
    // `openCashfreeCheckout` clears on settle and the screen clears again on
    // unmount. Removing an element already removed must not throw.
    plantSdkModal();
    dismissCashfreeOverlay();
    expect(() => dismissCashfreeOverlay()).not.toThrow();
    expect(document.getElementById('cashfree-modal-container')).toBeNull();
  });

  it('leaves the rest of the page alone', () => {
    const app = document.createElement('main');
    app.id = 'app-root';
    document.body.appendChild(app);
    plantSdkModal();

    dismissCashfreeOverlay();

    expect(document.getElementById('app-root')).not.toBeNull();
  });
});
