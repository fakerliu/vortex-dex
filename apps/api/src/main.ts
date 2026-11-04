import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // 全局 API 前缀 /api/v1
  app.setGlobalPrefix('api/v1');

  // 统一错误结构 + 统一成功包装
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // 允许跨域（本地开发前端端口不同）
  app.enableCors({ origin: true, credentials: false });

  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`VORTEX API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
