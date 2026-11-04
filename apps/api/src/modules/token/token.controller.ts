import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { TokenService } from './token.service';
import type {
  TokenBalanceDto,
  TokenDto,
  TokenListResult,
} from './token.types';

/**
 * Token 模块 API（挂 /api/v1 前缀，路由为 /api/v1/tokens/*）。
 * 注意：静态路由 /search、/verified 必须先于 :address 注册，避免被参数路由吞掉。
 */
@Controller('tokens')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  // GET /api/v1/tokens?chainId=&page=&limit=
  @Get()
  list(
    @Query('chainId') chainId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<TokenListResult> {
    return this.tokenService.getTokens({
      chainId: this.parseOptionalInt(chainId, 'chainId'),
      page: this.parseOptionalInt(page, 'page'),
      limit: this.parseOptionalInt(limit, 'limit'),
    });
  }

  // GET /api/v1/tokens/search?q=&chainId=
  @Get('search')
  search(
    @Query('q') q?: string,
    @Query('chainId') chainId?: string,
  ): Promise<TokenDto[]> {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('search 需要非空的 q 参数');
    }
    return this.tokenService.searchTokens(
      q.trim(),
      this.parseOptionalInt(chainId, 'chainId'),
    );
  }

  // GET /api/v1/tokens/verified?chainId=
  @Get('verified')
  verified(@Query('chainId') chainId?: string): Promise<TokenDto[]> {
    return this.tokenService.getVerifiedTokens(
      this.parseOptionalInt(chainId, 'chainId'),
    );
  }

  // GET /api/v1/tokens/:address/balance?wallet=&chainId=
  @Get(':address/balance')
  balance(
    @Param('address') address: string,
    @Query('wallet') wallet?: string,
    @Query('chainId') chainId?: string,
  ): Promise<TokenBalanceDto> {
    if (!wallet || wallet.trim().length === 0) {
      throw new BadRequestException('balance 需要非空的 wallet 参数');
    }
    return this.tokenService.getTokenBalance(
      this.resolveChainId(chainId),
      address,
      wallet.trim(),
    );
  }

  // GET /api/v1/tokens/:address?chainId=
  @Get(':address')
  detail(
    @Param('address') address: string,
    @Query('chainId') chainId?: string,
  ): Promise<TokenDto> {
    return this.tokenService.getToken(this.resolveChainId(chainId), address);
  }

  // ---------- 私有工具 ----------

  private parseOptionalInt(
    value: string | undefined,
    name: string,
  ): number | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new BadRequestException(`参数 ${name} 必须是整数`);
    }
    return n;
  }

  private resolveChainId(chainId?: string): number | undefined {
    return this.parseOptionalInt(chainId, 'chainId');
  }
}
