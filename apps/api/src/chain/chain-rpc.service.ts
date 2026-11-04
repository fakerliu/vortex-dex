import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  createPublicClient,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_RPC_URLS,
  isSupportedChainId,
} from './chain.constants';

/**
 * RPC 客户端单例：按 chain_id 缓存 viem PublicClient，避免重复创建连接。
 * - 支持 Base Mainnet（8453）与 Base Sepolia（84532）
 * - RPC 地址通过 env 注入，带超时与重试配置
 * - 公共 RPC 默认 https://mainnet.base.org / https://sepolia.base.org
 */
@Injectable()
export class ChainRpcService implements OnModuleDestroy {
  private readonly clients = new Map<number, PublicClient>();

  private readonly timeoutMs: number;

  constructor() {
    const raw = Number(process.env.RPC_TIMEOUT_MS ?? '10000');
    this.timeoutMs = Number.isFinite(raw) && raw > 0 ? raw : 10000;
  }

  getClient(chainId: number): PublicClient {
    if (!isSupportedChainId(chainId)) {
      throw new Error(`不支持的 chain_id: ${chainId}`);
    }

    let client = this.clients.get(chainId);
    if (!client) {
      client = this.createClient(chainId);
      this.clients.set(chainId, client);
    }
    return client;
  }

  getRpcUrl(chainId: number): string {
    if (chainId === BASE_MAINNET_CHAIN_ID) {
      return (
        process.env.BASE_MAINNET_RPC_URL ?? DEFAULT_RPC_URLS[BASE_MAINNET_CHAIN_ID]
      );
    }
    if (chainId === BASE_SEPOLIA_CHAIN_ID) {
      return (
        process.env.BASE_SEPOLIA_RPC_URL ?? DEFAULT_RPC_URLS[BASE_SEPOLIA_CHAIN_ID]
      );
    }
    throw new Error(`不支持的 chain_id: ${chainId}`);
  }

  private createClient(chainId: number): PublicClient {
    // 显式标注为泛型 Chain，避免 base/baseSepolia 各自的 formatter 类型
    // 泄漏到返回值，导致与 PublicClient 默认类型不兼容。
    const chain: Chain =
      chainId === BASE_MAINNET_CHAIN_ID ? base : baseSepolia;
    const transport = http(this.getRpcUrl(chainId), {
      timeout: this.timeoutMs,
      retryCount: 1,
    });
    // batch.multicall 默认开启，读元数据优先走 multicall
    return createPublicClient({
      chain,
      transport,
      batch: { multicall: true },
    });
  }

  onModuleDestroy(): void {
    this.clients.clear();
  }
}
