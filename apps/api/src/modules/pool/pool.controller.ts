import { Controller, Get, Param } from '@nestjs/common';

/**
 * Pool 流动性池模块骨架（Sprint 1 只建路由占位）。
 */
@Controller('pools')
export class PoolController {
  @Get()
  list(): { implemented: false; endpoint: string } {
    return { implemented: false, endpoint: 'GET /api/v1/pools' };
  }

  @Get(':id')
  detail(@Param('id') id: string): {
    implemented: false;
    endpoint: string;
    id: string;
  } {
    return { implemented: false, endpoint: 'GET /api/v1/pools/:id', id };
  }
}
