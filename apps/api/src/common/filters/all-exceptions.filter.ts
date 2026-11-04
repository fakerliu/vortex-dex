import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCodes } from '../constants/error-codes';

/**
 * 全局异常过滤器：将所有异常统一转换为
 * { success: false, error: { code, message }, path, timestamp, meta } 结构。
 * 顶层 timestamp 为历史字段保留（向后兼容），meta 为新增统一信封字段。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCodes.INTERNAL_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        code = this.codeFromStatus(status);
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        if (typeof r.message === 'string') {
          message = r.message;
        } else if (Array.isArray(r.message)) {
          message = r.message.join('; ');
        }
        // 优先保留业务层显式声明的错误码（如 RPC_UNAVAILABLE），否则按状态码推导
        code = typeof r.code === 'string' ? r.code : this.codeFromStatus(status);
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const timestamp = new Date().toISOString();
    const requestId = this.resolveRequestId(request);

    response.status(status).json({
      success: false,
      error: { code, message },
      path: request.url,
      timestamp,
      meta: { requestId, timestamp },
    });
  }

  /** 复用客户端传入的 X-Request-Id 作为追踪 id，否则生成新 UUID。 */
  private resolveRequestId(request: Request): string {
    const header = request?.headers?.['x-request-id'];
    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
    return randomUUID();
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return ErrorCodes.NOT_FOUND;
      case HttpStatus.BAD_REQUEST:
        return ErrorCodes.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCodes.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCodes.FORBIDDEN;
      case HttpStatus.CONFLICT:
        return ErrorCodes.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCodes.TOO_MANY_REQUESTS;
      case HttpStatus.NOT_IMPLEMENTED:
        return ErrorCodes.NOT_IMPLEMENTED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCodes.SERVICE_UNAVAILABLE;
      default:
        return ErrorCodes.INTERNAL_ERROR;
    }
  }
}
