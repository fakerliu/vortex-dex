import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RouteService } from './route.service';
import type { RouteRequestDto, RouteResponseDto } from './route.types';

/**
 * 路由引擎 API（挂 /api/v1 前缀，路由为 /api/v1/route）。
 * - POST /api/v1/route：计算多跳路由候选（按 NetOutput 排序）
 * - GET  /api/v1/route/:pathId：查询某次路由计算的候选
 */
@Controller('route')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  @Post()
  compute(@Body() body: RouteRequestDto): Promise<RouteResponseDto> {
    return this.routeService.computeRoute(body);
  }

  @Get(':pathId')
  detail(@Param('pathId') pathId: string): Promise<RouteResponseDto> {
    return this.routeService.getRoute(pathId);
  }
}
