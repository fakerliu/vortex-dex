import { formatUnits, parseUnits } from "viem";

/** 截断地址：0x1234...89AB */
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}...${address.slice(-chars)}`;
}

/**
 * 将最小单位（wei 字符串/bigint）格式化为人类可读金额。
 * 全程使用 viem 大数库，禁止 JS 浮点参与金额计算。
 */
export function formatTokenAmount(
  raw: string | bigint,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const value = formatUnits(BigInt(raw), decimals);
  const [int, frac] = value.split(".");
  if (!frac) return int;
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (trimmed === "") return int;
  return `${int}.${trimmed}`;
}

/** 将用户输入的人类可读金额解析为最小单位 bigint */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const normalized = amount.replace(/,/g, "").trim();
  if (!normalized || normalized === ".") return 0n;
  return parseUnits(normalized, decimals);
}

/** 格式化大数金额，带千分位（仅用于展示，不含精度损失） */
export function formatAmount(amount: string): string {
  const [int, frac] = amount.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${withCommas}.${frac}` : withCommas;
}

/** 校验用户输入是否为合法的小数金额 */
export function isValidAmountInput(value: string): boolean {
  if (value === "" || value === ".") return true;
  return /^\d*\.?\d*$/.test(value);
}
