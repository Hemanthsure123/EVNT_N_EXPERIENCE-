import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge, taught our custom design-token scales so conflicting utilities
 * resolve correctly (e.g. `text-h1` overrides `text-body`; `shadow-glow` is in
 * the shadow group). Keeps className composition predictable across components.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display',
            'h1',
            'h2',
            'h3',
            'h4',
            'body-lg',
            'body',
            'body-sm',
            'label',
            'caption',
          ],
        },
      ],
      shadow: [{ shadow: ['sm', 'md', 'lg', 'xl', 'glow', 'none'] }],
    },
  },
});

/** Compose and de-conflict Tailwind classes. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
