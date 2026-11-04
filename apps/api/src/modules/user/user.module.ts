import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * 用户系统模块（Sprint 8）。
 * 依赖 PrismaModule（@Global），无需重复导入。
 * 依赖 MarketModule（export MarketService）：Portfolio 计算 USD 估值。
 */
@Module({
  imports: [MarketModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
