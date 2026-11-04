/**
 * Aerodrome Adapter 共享工具。
 */
import type { PublicClient } from 'viem';
import { ChainReadError, errorMessage } from '../../chain/chain.errors';
import { assertValidAddress } from '../../chain/address';
import { BPS_TO_PPM } from './constants';

/** 校验并规范化地址（小写）。 */
export function toAddress(address: string, label = 'address'): `0x${string}` {
  return assertValidAddress(address, label) as `0x${string}`;
}

/** classic 池费率：链上 getFee 返回 bps，统一转 ppm（1e6=100%）。 */
export function feeBpsToPpm(bps: bigint): bigint {
  return bps * BPS_TO_PPM;
}

/** 判断地址是否为零地址。 */
export function isZeroAddress(address: string): boolean {
  return (
    address === '0x0000000000000000000000000000000000000000' ||
    address === '0x0'
  );
}

/** 排序 token 地址，保证 (a,b) 与 (b,a) 得到一致的 token0/token1。 */
export function sortTokens(
  a: string,
  b: string,
): { token0: string; token1: string } {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x <= y ? { token0: x, token1: y } : { token0: y, token1: x };
}

/**
 * 读合约视图函数的统一包装：RPC 失败统一抛 ChainReadError，
 * 上层据此翻译为 503 / RPC_UNAVAILABLE。
 */
export async function callView<T>(params: {
  client: PublicClient;
  chainId: number;
  address: `0x${string}`;
  abi: unknown;
  functionName: string;
  args?: unknown[];
  label: string;
}): Promise<T> {
  const { client, chainId, address, abi, functionName, args, label } = params;
  try {
    return (await client.readContract({
      address,
      abi: abi as never,
      functionName,
      args,
    } as never)) as T;
  } catch (err) {
    throw new ChainReadError(
      chainId,
      `${label} 失败（chain=${chainId} address=${address} fn=${functionName}）: ${errorMessage(err)}`,
    );
  }
}
