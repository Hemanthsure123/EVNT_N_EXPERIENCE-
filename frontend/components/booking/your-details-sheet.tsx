'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth/auth-provider';
import { updateProfile } from '@/lib/api/profile';

/**
 * "Your details" — the name and number a ticket is issued against.
 *
 * ── WHY IT EXISTS, AND WHY IT IS THIS SMALL ───────────────────────────────
 *
 * Review showed the account's name and email as static text with no way to
 * correct either. A ticket is issued against that name, and somebody whose
 * account still says what they typed in a hurry six months ago had to leave
 * the funnel, find account settings, and start the booking again — losing the
 * inventory hold on the way.
 *
 * It edits exactly two fields, because exactly two are editable:
 *
 *   NAME and PHONE  — real columns, and `PATCH /auth/me` accepts both.
 *   EMAIL           — read-only, and NOT because it was awkward to build. It
 *                     is the sign-in identity: changing it here would change
 *                     which account you are, mid-checkout, on the screen where
 *                     money is about to move. It is shown, and labelled, so
 *                     nobody hunts for a control that should not be there.
 *
 * There is NO address and NO state field. The reference design has them
 * because that product issues a GST invoice; this backend has no address
 * column on the user, no invoice model and no tax line, so a state selector
 * here would collect something nothing reads and imply an invoice nothing
 * produces.
 *
 * ── ONE SHEET PRIMITIVE ───────────────────────────────────────────────────
 *
 * `Drawer` with `side="responsive"` — a bottom sheet on a phone, a side panel
 * from `lg`. It already brings the opaque surface, the dimmed and blurred
 * scrim, exactly one close control, the focus trap and the scrollable body.
 * A hand-rolled sheet here would be a second set of focus bugs.
 */
export function YourDetailsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, applyProfile } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed on every open: an edit abandoned by closing the sheet must not
  // come back the next time it is opened, and a change made elsewhere must be
  // reflected.
  React.useEffect(() => {
    if (!open) return;
    setFullName(user?.full_name ?? '');
    setPhone(user?.phone ?? '');
    setError(null);
  }, [open, user]);

  if (!user) return null;

  const dirty = fullName !== (user.full_name ?? '') || phone !== (user.phone ?? '');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dirty) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // The response IS the fresh profile, so it is swapped in wholesale
      // rather than patched field by field — a locally-patched copy is a
      // second source of truth that drifts from the server's.
      const profile = await updateProfile({ full_name: fullName.trim(), phone: phone.trim() });
      applyProfile(profile);
      toast({ title: 'Details updated', variant: 'success' });
      onOpenChange(false);
    } catch (cause) {
      // Named, not swallowed. This runs while an inventory hold is ticking, so
      // "something went wrong" with no detail is the worst possible answer.
      setError(cause instanceof Error ? cause.message : 'Could not save those details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="responsive" aria-label="Your details" bare>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex shrink-0 flex-col gap-stack border-b border-border px-6 pb-card pt-card-lg">
            <DrawerTitle>Your details</DrawerTitle>
            <DrawerDescription>
              Your ticket is issued in this name, and we send it to this address.
            </DrawerDescription>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto px-6 py-card-lg">
            <FormField label="Full name" htmlFor="details-name">
              <Input
                id="details-name"
                name="name"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </FormField>

            <FormField
              label="Phone"
              htmlFor="details-phone"
              description="Used for booking updates. Optional."
            >
              <Input
                id="details-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </FormField>

            <FormField
              label="Email"
              htmlFor="details-email"
              description="This is the address you sign in with, so it cannot be changed here. Update it in account settings."
            >
              <Input id="details-email" value={user.email} readOnly disabled />
            </FormField>

            {error ? (
              <p role="alert" className="text-body-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <footer
            className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-elevated px-6 pt-card"
            // Safe-area aware: on a phone with a gesture bar the last 34px
            // belong to the system, and Confirm underneath it is a form with no
            // way to submit.
            style={{ paddingBottom: 'calc(var(--space-card) + env(safe-area-inset-bottom))' }}
          >
            <Button type="submit" size="lg" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </Button>
          </footer>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
