import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserService } from './user.service';
import type {
  PortfolioDto,
  UserProfileDto,
  UserSwapListResult,
} from './user.types';

/**
 * 用户系统 API（挂 /api/v1 前缀，路由为 /api/v1/users）。
 * - POST /api/v1/users                 ：注册 / 获取用户（幂等）
 * - GET  /api/v1/users/:address        ：钱包识别 + 交易统计
 * - GET  /api/v1/users/:address/swaps  ：用户交易列表（分页，时间倒序）
 * - GET  /api/v1/users/:address/portfolio：资产中心（多 token 余额 + USD 估值）
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  register(@Body() body: { walletAddress?: string }): Promise<UserProfileDto> {
    return this.userService.register(body?.walletAddress ?? '');
  }

  @Get(':address/swaps')
  swaps(
    @Param('address') address: string,
    @Query('chainId') chainId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<UserSwapListResult> {
    return this.userService.getUserSwaps(
      address,
      chainId !== undefined ? Number(chainId) : undefined,
      page !== undefined ? Number(page) : undefined,
      limit !== undefined ? Number(limit) : undefined,
    );
  }

  @Get(':address/portfolio')
  portfolio(
    @Param('address') address: string,
    @Query('chainId') chainId?: string,
  ): Promise<PortfolioDto> {
    return this.userService.getPortfolio(
      address,
      chainId !== undefined ? Number(chainId) : undefined,
    );
  }

  @Get(':address')
  profile(@Param('address') address: string): Promise<UserProfileDto> {
    return this.userService.getProfile(address);
  }
}
