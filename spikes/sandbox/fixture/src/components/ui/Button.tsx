import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center gap-2 rounded-xl2 px-4 py-2 text-sm font-medium transition',
        variant === 'primary' && 'bg-brand-500 text-white hover:bg-brand-900',
        variant === 'ghost' && 'bg-transparent text-brand-900 hover:bg-brand-50',
        variant === 'danger' && 'bg-agz text-white',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
