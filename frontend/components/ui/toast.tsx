'use client';

import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { type VariantProps, cva } from 'class-variance-authority';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ToastVariant = 'default' | 'success' | 'warning' | 'destructive' | 'info';

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastContextValue = { toast: (options: ToastOptions) => void };
const ToastContext = React.createContext<ToastContextValue | null>(null);

const toastVariants = cva(
  'pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border p-4 shadow-lg data-[state=open]:animate-scale-in',
  {
    variants: {
      variant: {
        default: 'border-border bg-elevated text-foreground',
        success: 'border-success/30 bg-success-subtle text-success-subtle-foreground',
        warning: 'border-warning/30 bg-warning-subtle text-warning-subtle-foreground',
        destructive:
          'border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground',
        info: 'border-info/30 bg-info-subtle text-info-subtle-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const ICONS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
  info: Info,
};

type ToastItem = ToastOptions & { id: number };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const counter = React.useRef(0);

  const toast = React.useCallback((options: ToastOptions) => {
    counter.current += 1;
    setItems((prev) => [...prev, { id: counter.current, ...options }]);
  }, []);

  const value = React.useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => {
          const variant = item.variant ?? 'default';
          const Icon = ICONS[variant];
          return (
            <ToastPrimitive.Root
              key={item.id}
              duration={item.duration ?? 5000}
              onOpenChange={(open) => {
                if (!open) setItems((prev) => prev.filter((t) => t.id !== item.id));
              }}
              className={cn(toastVariants({ variant }))}
            >
              <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-body-sm font-semibold">
                  {item.title}
                </ToastPrimitive.Title>
                {item.description ? (
                  <ToastPrimitive.Description className="text-body-sm opacity-90">
                    {item.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                aria-label="Dismiss"
                className="rounded-sm opacity-70 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" aria-hidden />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-toast flex w-full max-w-[24rem] flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

export type ToastVariantProps = VariantProps<typeof toastVariants>;
