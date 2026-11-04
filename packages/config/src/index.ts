/**
 * 环境变量读取工具。
 * 统一从 process.env 读取，带缺省值与类型转换，避免各服务各自解析。
 * 注意：本包不负责加载 .env 文件；由各应用入口（Next.js / NestJS / dotenv）负责注入。
 */

export type Environment = 'local' | 'testnet' | 'mainnet';

/** 读取字符串环境变量；缺失且无缺省值时抛错。 */
export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing required environment variable: ${name}`);
}

/** 读取数字环境变量；无法解析时抛错。 */
export function getEnvNumber(name: string, fallback?: number): number {
  const raw = getEnv(name, fallback !== undefined ? String(fallback) : undefined);
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} is not a valid number: "${raw}"`);
  }
  return parsed;
}

/** 读取布尔环境变量（1/true/yes/on 视为 true）。 */
export function getEnvBoolean(name: string, fallback = false): boolean {
  const raw = getEnv(name, String(fallback)).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

/** 读取并校验 APP_ENV。 */
export function getEnvironment(): Environment {
  const env = getEnv('APP_ENV', 'local').toLowerCase();
  if (env === 'local' || env === 'testnet' || env === 'mainnet') {
    return env;
  }
  throw new Error(`Unknown APP_ENV: ${env}`);
}
