import { Controller, Get, Post } from '@nestjs/common';
import { IndexerService } from './indexer.service';
import type { IndexerStatus, ScanSummary } from './indexer.types';

/**
 * Indexer 同步状态监控 + 手动触发（Sprint 7）。
 * - GET  /indexer/status：当前扫描到哪个区块、链上最新区块、落后多少。
 * - POST /indexer/scan  ：手动触发一轮扫描（幂等，重复调用不重复写入）。
 */
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexer: IndexerService) {}

  @Get('status')
  async status(): Promise<IndexerStatus> {
    return this.indexer.getStatus();
  }

  @Post('scan')
  async scan(): Promise<ScanSummary> {
    return this.indexer.scanOnce();
  }
}
