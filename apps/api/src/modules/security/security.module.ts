import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

/**
 * Security 模块（MODULE 08 Token Security 安全中心）。
 *
 * 依赖：PrismaModule / ChainModule 均为 @Global，直接注入
 * PrismaService / ChainRpcService，无需重复导入。
 */
@Module({
  controllers: [SecurityController],
  providers: [SecurityService],
  exports: [SecurityService],
})
export class SecurityModule {}
