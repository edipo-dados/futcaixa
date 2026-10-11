import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina classes condicionais (clsx) e resolve conflitos do Tailwind
 * (tailwind-merge). Base do padrão de componentes shadcn/ui.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
