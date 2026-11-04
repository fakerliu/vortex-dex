import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { SecurityService } from './security.service';
import type { TokenSecurityDto } from './security.types';

/**
 * Security 模块 API（挂 /api/v1 前缀，路由为 /api/v1/security/*）。
 */
@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  // GET /api/v1/security/token/:address?chainId=
  @Get('token/:address')
  token(
    @Param('address') address: string,
    @Query('chainId') chainId?: string,
  ): Promise<TokenSecurityDto> {
    if (!address || address.trim().length === 0) {
      throw new BadRequestException('security 需要非空的 address 路径参数');
    }
    return this.securityService.getTokenSecurity(
      this.parseOptionalInt(chainId, 'chainId'),
      address.trim(),
    );
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
}
