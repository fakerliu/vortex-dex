/**
 * 地址工具：统一小写规范化 + 格式校验。
 * 所有链上地址入库前一律小写（chain_id + 小写地址 作为唯一键）。
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(address: string): boolean {
  return ADDRESS_RE.test(address);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function assertValidAddress(address: string, label = 'address'): string {
  if (!isValidAddress(address)) {
    throw new Error(`${label} 不是合法的 EVM 地址: ${address}`);
  }
  return normalizeAddress(address);
}
