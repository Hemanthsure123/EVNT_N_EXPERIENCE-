import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Subsection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-label uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/** A colour swatch driven straight off a CSS token variable (proves the token
 * resolves + flips per theme). */
export function Swatch({
  token,
  name,
  className,
}: {
  token: string;
  name: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn('h-14 rounded-lg border border-border', className)}
        style={{ backgroundColor: `rgb(var(--${token}))` }}
      />
      <div className="flex flex-col">
        <span className="text-caption font-medium text-foreground">{name}</span>
        <span className="font-mono text-caption text-muted-foreground">--{token}</span>
      </div>
    </div>
  );
}
