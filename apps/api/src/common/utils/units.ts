/**
 * 精度工具：金额格式化（纯字符串 + BigInt，绝不使用 Float）。
 * - raw：链上原始大整数（如 "1000000000000000000"）
 * - decimals：token decimals
 * - formatted：按 decimals 对齐小数点后的字符串（去掉末尾多余 0）
 */
export function formatUnits(raw: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`decimals 必须为非负整数: ${decimals}`);
  }

  let value = raw;
  let negative = false;
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  }
  // 去除前导 0（保留至少一个数字）
  value = value.replace(/^0+(?=\d)/, '');
  if (value === '') {
    value = '0';
  }

  if (decimals === 0) {
    return (negative ? '-' : '') + value;
  }

  const padded = value.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals);
  let fracPart = padded.slice(padded.length - decimals);
  fracPart = fracPart.replace(/0+$/, '');

  const sign = negative ? '-' : '';
  return fracPart.length > 0
    ? `${sign}${intPart}.${fracPart}`
    : `${sign}${intPart}`;
}
