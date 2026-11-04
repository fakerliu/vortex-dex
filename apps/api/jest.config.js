/** @type {import('jest').Config} */
module.exports = {
  // NestJS 生态标准：ts-jest 转译 TS，node 环境运行
  preset: 'ts-jest',
  testEnvironment: 'node',
  // 测试只放在 src 下（与业务代码同目录的 *.spec.ts）
  roots: ['<rootDir>/src'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  // 纯函数 + mock 依赖测试，不连数据库 / 不发 RPC
  clearMocks: true,
  restoreMocks: true,
};
