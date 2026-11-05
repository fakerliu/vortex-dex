import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ChainModule } from './chain/chain.module';
import { DexModule } from './dex/dex.module';
import { HealthModule } from './modules/health/health.module';
import { TokenModule } from './modules/token/token.module';
import { MarketModule } from './modules/market/market.module';
import { QuoteModule } from './modules/quote/quote.module';
import { RouteModule } from './modules/route/route.module';
import { SwapModule } from './modules/swap/swap.module';
import { SwapReconcilerModule } from './modules/swap/swap-reconciler.module';
import { UserModule } from './modules/user/user.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ProtocolModule } from './modules/protocol/protocol.module';
import { PoolModule } from './modules/pool/pool.module';
import { IndexerModule } from './indexer/indexer.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { SecurityModule } from './modules/security/security.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    ChainModule,
    DexModule,
    HealthModule,
    TokenModule,
    MarketModule,
    QuoteModule,
    RouteModule,
    SwapModule,
    SwapReconcilerModule,
    UserModule,
    AnalyticsModule,
    ProtocolModule,
    PoolModule,
    IndexerModule,
    ApprovalModule,
    SecurityModule,
    AlertsModule,
    PreferencesModule,
    NotificationsModule,
  ],
})
export class AppModule {}
