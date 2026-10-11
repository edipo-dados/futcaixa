import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Checkbox nativo estilizado.
 *
 * Evita a dependência @radix-ui/react-checkbox usando o `<input type="checkbox">`
 * nativo (consistente com `label.tsx`/`select.tsx`). O `accent-color` do
 * Tailwind garante uma marcação coerente com o tema sem JS extra, e o controle
 * nativo é acessível e amigável ao toque (mobile-first).
 */
export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "size-4 shrink-0 cursor-pointer rounded border border-input accent-primary shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
