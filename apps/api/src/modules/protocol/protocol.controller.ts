import { Controller, Get, Param } from '@nestjs/common';

/**
 * Protocol（DEX 协议管理）模块骨架（Sprint 1 只建路由占位）。
 */
@Controller('protocols')
export class ProtocolController {
  @Get()
  list(): { implemented: false; endpoint: string } {
    return { implemented: false, endpoint: 'GET /api/v1/protocols' };
  }

  @Get(':id')
  detail(@Param('id') id: string): {
    implemented: false;
    endpoint: string;
    id: string;
  } {
    return { implemented: false, endpoint: 'GET /api/v1/protocols/:id', id };
  }
}
