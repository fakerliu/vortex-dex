/**
 * 链上读取错误：由 Erc20ReaderService 抛出，业务层据此返回 503 / RPC_UNAVAILABLE。
 * RPC 因网络/代理不可达时优雅降级，不抛未处理的 500。
 */
export class ChainReadError extends Error {
  public readonly chainId: number;

  constructor(chainId: number, message: string) {
    super(message);
    this.name = 'ChainReadError';
    this.chainId = chainId;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
