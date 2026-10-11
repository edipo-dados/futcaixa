import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Barra de progresso presentacional, no estilo shadcn/ui, porém sem depender
 * de `@radix-ui/react-progress` (evita adicionar nova dependência). É só um
 * trilho (`track`) com uma barra interna cuja largura é o percentual.
 *
 * O `value` esperado está no intervalo `[0, 100]`; valores fora são limitados
 * defensivamente. Expõe atributos ARIA de `progressbar` para acessibilidade.
 */
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Percentual concluído (0 a 100). */
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const percent = Math.min(100, Math.max(0, value));

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
          className,
        )}
        {...props}
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
