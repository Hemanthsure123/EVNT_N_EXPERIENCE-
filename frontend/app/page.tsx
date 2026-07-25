import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-container flex-col items-center justify-center gap-8 px-4 py-16 text-center">
      <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-label text-secondary-foreground">
        <Sparkles className="size-4" aria-hidden />
        Frontend foundation
      </span>
      <h1 className="max-w-2xl text-h1 md:text-display">
        <span className="text-gradient-brand">Event & Experience</span> design system + app shell
      </h1>
      <p className="max-w-xl text-body-lg text-muted-foreground">
        The token-driven foundation for the Next.js frontend — premium, accessible, responsive, and
        fast, in light and dark. Feature screens come next.
      </p>
      <Button asChild size="lg" emphasis>
        <Link href="/style-guide">
          Open the living style guide
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </main>
  );
}
