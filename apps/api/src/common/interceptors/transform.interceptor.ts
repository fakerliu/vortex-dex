import { randomUUID } from 'node:crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

/**
 * 统一成功响应包装：将 controller 返回值包装为
 * { success: true, data, meta: { requestId, timestamp } }。
 * 保持 { success, data } 结构向后兼容，meta 为新增字段。
 * 异常响应由 AllExceptionsFilter 处理，不会经过本拦截器。
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiSuccessResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = this.resolveRequestId(request);
    const timestamp = new Date().toISOString();

    return next.handle().pipe(
      map((data): ApiSuccessResponse<T> => ({
        success: true,
        data,
        meta: { requestId, timestamp },
      })),
    );
  }

  /** 复用客户端传入的 X-Request-Id 作为追踪 id，否则生成新 UUID。 */
  private resolveRequestId(request: Request): string {
    const header = request?.headers?.['x-request-id'];
    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
    return randomUUID();
  }
}
