import { clsx, type ClassValue } from "clsx";

/** 合并 className，统一处理条件类名 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
