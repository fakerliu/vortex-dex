import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { QuoteService } from './quote.service';
import type { QuoteRequestDto, QuoteResponseDto } from './quote.types';

/**
 * 报价引擎 API（挂 /api/v1 前缀，路由为 /api/v1/quote）。
 * - POST /api/v1/quote：生成报价
 * - GET  /api/v1/quote/:id：查询历史报价（过期返回 410）
 */
@Controller('quote')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Post()
  create(@Body() body: QuoteRequestDto): Promise<QuoteResponseDto> {
    return this.quoteService.createQuote(body);
  }

  @Get(':id')
  detail(@Param('id') id: string): Promise<QuoteResponseDto> {
    return this.quoteService.getQuote(id);
  }
}
