import { Global, Module } from '@nestjs/common';
import { ChainRpcService } from './chain-rpc.service';
import { Erc20ReaderService } from './erc20-reader.service';

/**
 * 链层全局模块：RPC 客户端单例 + ERC-20 读取服务。
 * 供 Token 模块使用，后续 Quote / Route / Swap 模块也可复用。
 */
@Global()
@Module({
  providers: [ChainRpcService, Erc20ReaderService],
  exports: [ChainRpcService, Erc20ReaderService],
})
export class ChainModule {}
