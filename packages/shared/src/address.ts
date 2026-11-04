/**
 * 地址相关工具函数。
 * 仅做格式校验与规范化，不涉及链上查询。
 */

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/** 判断字符串是否为合法的 0x 前缀 40 位十六进制地址。 */
export function isAddress(value: string): boolean {
  return typeof value === 'string' && ADDRESS_REGEX.test(value.trim());
}

/**
 * 规范化地址：去除首尾空白、统一为小写、补齐 0x 前缀。
 * 不校验校验和（checksum），仅保证格式统一，便于比较/存储。
 */
export function normalizeAddress(address: string): string {
  if (typeof address !== 'string' || address.trim() === '') {
    throw new Error('Address must be a non-empty string');
  }
  const trimmed = address.trim().toLowerCase();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

/** 缩短地址用于展示，例如 0x1234...abcd。 */
export function shortenAddress(address: string, chars = 4): string {
  const normalized = normalizeAddress(address);
  if (!isAddress(normalized)) {
    return address;
  }
  return `${normalized.slice(0, 2 + chars)}...${normalized.slice(-chars)}`;
}
