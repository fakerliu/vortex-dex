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

/**
 * 十进制字符串的小数点位移（仅字符串操作，不经过 JS 浮点）。
 * 用于把后端返回的比率字符串转换为百分比等派生展示。
 *
 * 例：shiftDecimalPoint("0.000253390435906198", 2) -> "0.0253390435906198"
 */
export function shiftDecimalPoint(value: string, places: number): string {
  const neg = value.startsWith("-");
  const abs = neg ? value.slice(1) : value;
  const [int, frac = ""] = abs.split(".");
  const digits = int + frac;
  const pointIndex = int.length + places;

  let result: string;
  if (pointIndex <= 0) {
    result = `0.${"0".repeat(-pointIndex)}${digits}`;
  } else if (pointIndex >= digits.length) {
    result = `${digits}${"0".repeat(pointIndex - digits.length)}`;
  } else {
    result = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
  }

  const [ri, rf] = result.split(".");
  const intPart = ri.replace(/^0+(?=\d)/, "");
  const normalized = rf !== undefined ? `${intPart}.${rf}` : intPart;
  return (neg ? "-" : "") + normalized;
}

/**
 * 十进制字符串格式化：限制小数位、去掉尾部 0、整数部分加千分位。
 * 仅用于展示，全程字符串，无精度损失。
 */
export function formatDecimalString(
  value: string,
  maxFractionDigits = 6,
): string {
  const neg = value.startsWith("-");
  const abs = neg ? value.slice(1) : value;
  const [int, frac] = abs.split(".");
  const intWithCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  if (!frac) return (neg ? "-" : "") + intWithCommas;
  const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  if (trimmed === "") return (neg ? "-" : "") + intWithCommas;
  return (neg ? "-" : "") + `${intWithCommas}.${trimmed}`;
}

/**
 * 后端 priceImpact 为十进制小数字符串（如 "0.000253390435906198"）。
 * 转为百分比字符串：乘 100 后格式化，返回 "0.0253%"（不含 % 由调用方拼接亦可）。
 */
export function priceImpactToPercent(
  priceImpact: string,
  maxFractionDigits = 4,
): string {
  if (!priceImpact || priceImpact === "0" || priceImpact === "0.0") return "0";
  return formatDecimalString(shiftDecimalPoint(priceImpact, 2), maxFractionDigits);
}
