import { Module } from '@nestjs/common';
import { IndexerController } from './indexer.controller';
import { IndexerService } from './indexer.service';

/**
 * 区块链 Indexer 模块（Sprint 7）。
 * 依赖 PrismaModule（@Global），无需重复导入。
 */
@Module({
  controllers: [IndexerController],
  providers: [IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
