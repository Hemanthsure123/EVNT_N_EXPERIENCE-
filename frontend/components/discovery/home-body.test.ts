import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ONE LANDING PAGE, TWO MOUNTS.
 *
 * An organizer pressing Home used to be sent to `/`, which is a different
 * route GROUP — so the attendee shell took over and the four-tab public bar
 * replaced the organizer's own. The fix is `/dashboard/home`: the same landing
 * page rendered under the dashboard layout, where the chrome stays put.
 *
 * That means one page arrangement in two route groups, and this is the file
 * that stops it becoming two. A source scan rather than a render, for the same
 * reason `static-routes.test.ts` reads the filesystem: the claim is about how
 * the two routes are COMPOSED, and there is no rendered output in which
 * "these two pages share a component" is visible.
 *
 * Every assertion here fails silently in production. A second copy of the
 * sections renders perfectly — identically, the week it is written.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const PUBLIC_PAGE = 'app/(site)/page.tsx';
const ORGANIZER_PAGE = 'app/(organizer)/dashboard/home/page.tsx';
const SITE_LAYOUT = 'app/(site)/layout.tsx';

describe('both landing routes render the same body', () => {
  it('the public route delegates to HomeBody', () => {
    const source = read(PUBLIC_PAGE);
    expect(source).toContain('HomeBody');
    // And does NOT compose the sections itself — the shape the split undid.
    expect(source).not.toContain('<Showcase');
    expect(source).not.toContain('<AllEvents');
  });

  it('the organizer route delegates to the same component', () => {
    const source = read(ORGANIZER_PAGE);
    expect(source).toContain("from '@/components/discovery/home-body'");
    expect(source).toContain('<HomeBody />');
    expect(source).not.toContain('<Showcase');
  });
});

describe('what stays on the public URL only', () => {
  it('keeps the canonical and the WebSite structured data off the dashboard copy', () => {
    // They are claims about `/`. The dashboard group is `noindex`, and telling
    // a crawler that the copy behind a login is the same document is the one
    // thing this split could get actively wrong.
    // Matched on the CODE, not on the word: both files discuss the split in
    // prose, and a scan that trips over its own documentation is a scan
    // nobody trusts the next time it goes red.
    expect(read(PUBLIC_PAGE)).toContain('alternates: { canonical');
    expect(read(PUBLIC_PAGE)).toContain('webSiteJsonLd({');

    const organizer = read(ORGANIZER_PAGE);
    expect(organizer).not.toContain('alternates:');
    expect(organizer).not.toContain('webSiteJsonLd({');
  });
});

describe('there is ONE discovery provider stack', () => {
  it('both mounts go through DiscoveryProviders', () => {
    // A discovery card opens the mobile event deck on press. A route missing
    // `EventDeckProvider` renders flawlessly and throws on the first tap —
    // which is exactly the failure a second hand-assembled stack produces.
    expect(read(SITE_LAYOUT)).toContain('<DiscoveryProviders');
    expect(read(ORGANIZER_PAGE)).toContain('<DiscoveryProviders');
  });

  it('neither one hand-rolls the providers beside it', () => {
    for (const path of [SITE_LAYOUT, ORGANIZER_PAGE]) {
      const source = read(path);
      expect(source).not.toContain('<LocationProvider');
      expect(source).not.toContain('<SearchProvider');
      expect(source).not.toContain('<EventDeckProvider');
      // The deck is mounted by the providers component, once.
      expect(source).not.toContain('<EventWidgetDeck');
    }
  });
});

describe('the organizer route keeps the dashboard chrome', () => {
  it('lives under the dashboard segment, which is what makes the bar stay', () => {
    // The whole bug was the route GROUP changing. `(organizer)/dashboard/...`
    // is what keeps `DashboardShell` — and therefore the organizer's own
    // header and bottom bar — wrapped around it.
    expect(ORGANIZER_PAGE.startsWith('app/(organizer)/dashboard/')).toBe(true);
  });

  it('does not pull in any attendee chrome', () => {
    const source = read(ORGANIZER_PAGE);
    for (const attendee of ['SiteHeader', 'SiteFooter', 'SiteBottomNav', 'AnnouncementBar']) {
      expect(source).not.toContain(attendee);
    }
  });
});
