import { Injectable } from '@nestjs/common';
import { erc20Abi, type PublicClient } from 'viem';
import { ChainRpcService } from './chain-rpc.service';
import { ChainReadError, errorMessage } from './chain.errors';
import { assertValidAddress } from './address';

export interface Erc20Metadata {
  address: string; // 小写规范化
  symbol: string;
  name: string;
  decimals: number;
}

/**
 * ERC-20 链上读取服务：
 * - readMetadata：读 name / symbol / decimals（优先 multicall，失败回退逐个 readContract）
 * - readBalance：读 balanceOf，返回原始大整数（bigint）
 * 所有 RPC 异常统一包装为 ChainReadError，由业务层翻译为 503 / RPC_UNAVAILABLE。
 */
@Injectable()
export class Erc20ReaderService {
  constructor(private readonly rpc: ChainRpcService) {}

  async readMetadata(
    chainId: number,
    address: string,
  ): Promise<Erc20Metadata> {
    const addr = assertValidAddress(address, 'token address') as `0x${string}`;
    const client = this.rpc.getClient(chainId);

    try {
      return await this.readMetadataViaMulticall(client, addr);
    } catch (multicallErr) {
      // 部分公共 RPC 对 multicall 支持不佳，回退逐个 readContract
      try {
        return await this.readMetadataIndividual(client, addr);
      } catch (individualErr) {
        throw new ChainReadError(
          chainId,
          `读取 Token 元数据失败（chain=${chainId} address=${addr}）` +
            ` multicall: ${errorMessage(multicallErr)};` +
            ` readContract: ${errorMessage(individualErr)}`,
        );
      }
    }
  }

  async readBalance(
    chainId: number,
    address: string,
    wallet: string,
  ): Promise<bigint> {
    const addr = assertValidAddress(address, 'token address') as `0x${string}`;
    const owner = assertValidAddress(wallet, 'wallet') as `0x${string}`;
    const client = this.rpc.getClient(chainId);

    try {
      const balance = await client.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      });
      return balance as bigint;
    } catch (err) {
      throw new ChainReadError(
        chainId,
        `读取余额失败（chain=${chainId} token=${addr} wallet=${owner}）: ${errorMessage(err)}`,
      );
    }
  }

  async readAllowance(
    chainId: number,
    address: string,
    owner: string,
    spender: string,
  ): Promise<bigint> {
    const addr = assertValidAddress(address, 'token address') as `0x${string}`;
    const ownerAddr = assertValidAddress(owner, 'owner') as `0x${string}`;
    const spenderAddr = assertValidAddress(spender, 'spender') as `0x${string}`;
    const client = this.rpc.getClient(chainId);

    try {
      const allowance = await client.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ownerAddr, spenderAddr],
      });
      return allowance as bigint;
    } catch (err) {
      throw new ChainReadError(
        chainId,
        `读取授权失败（chain=${chainId} token=${addr} owner=${ownerAddr} spender=${spenderAddr}）: ${errorMessage(err)}`,
      );
    }
  }

  private async readMetadataViaMulticall(
    client: PublicClient,
    addr: `0x${string}`,
  ): Promise<Erc20Metadata> {
    const results = await client.multicall({
      allowFailure: true,
      contracts: [
        { address: addr, abi: erc20Abi, functionName: 'name' },
        { address: addr, abi: erc20Abi, functionName: 'symbol' },
        { address: addr, abi: erc20Abi, functionName: 'decimals' },
      ],
    });

    const [nameRes, symbolRes, decimalsRes] = results;
    if (
      nameRes.status === 'failure' ||
      symbolRes.status === 'failure' ||
      decimalsRes.status === 'failure'
    ) {
      throw new Error('multicall 部分调用失败');
    }

    return {
      address: addr,
      name: nameRes.result as string,
      symbol: symbolRes.result as string,
      decimals: Number(decimalsRes.result),
    };
  }

  private async readMetadataIndividual(
    client: PublicClient,
    addr: `0x${string}`,
  ): Promise<Erc20Metadata> {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'name',
      }),
      client.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'symbol',
      }),
      client.readContract({
        address: addr,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
    ]);

    return {
      address: addr,
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
    };
  }
}
