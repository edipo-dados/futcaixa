import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Select nativo estilizado.
 *
 * Para evitar adicionar dependências novas (@radix-ui/react-select), usamos o
 * `<select>` nativo — consistente com o `label.tsx`, que também usa o elemento
 * nativo. O `<select>` nativo é acessível por padrão e tem ótima experiência
 * em dispositivos móveis (abre o seletor nativo do sistema), alinhado ao
 * requisito mobile-first.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            "flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
