import {
  Q192,
  combinePriceImpacts,
  computePriceImpact,
  computePriceImpactFromSpot,
  formatFraction,
  formatPrice,
  getAmountOutConstantProduct,
  maxAmountInConstantProduct,
  parseAmount,
  parseDecimal,
  sqrtPriceX96ToMidPrice,
} from './math';

describe('dex/math 纯函数（金额精度）', () => {
  // ---------- parseAmount ----------
  describe('parseAmount', () => {
    it('解析合法整数', () => {
      expect(parseAmount('123')).toBe(123n);
      expect(parseAmount('0')).toBe(0n);
      expect(parseAmount(' 42 ')).toBe(42n);
    });

    it('解析负数', () => {
      expect(parseAmount('-5')).toBe(-5n);
    });

    it('空串抛错', () => {
      expect(() => parseAmount('')).toThrow();
      expect(() => parseAmount('   ')).toThrow();
    });

    it('非法字符抛错', () => {
      expect(() => parseAmount('abc')).toThrow();
      expect(() => parseAmount('12.5')).toThrow();
      expect(() => parseAmount('1e3')).toThrow();
      expect(() => parseAmount('0x10')).toThrow();
    });
  });

  // ---------- formatFraction ----------
  describe('formatFraction', () => {
    it('正常除法（去尾零）', () => {
      expect(formatFraction(1n, 2n, 18)).toBe('0.5');
      expect(formatFraction(1n, 3n, 18)).toBe('0.333333333333333333');
      expect(formatFraction(10n, 1n, 18)).toBe('10');
      expect(formatFraction(1n, 4n, 18)).toBe('0.25');
    });

    it('den=0 抛错', () => {
      expect(() => formatFraction(1n, 0n, 18)).toThrow('除数不能为 0');
    });
  });

  // ---------- getAmountOutConstantProduct ----------
  describe('getAmountOutConstantProduct', () => {
    it('恒定乘积公式正确性（fee=0）', () => {
      // amountOut = reserveOut * amountIn / (reserveIn + amountIn)
      const out = getAmountOutConstantProduct({
        reserveIn: 1000n,
        reserveOut: 2000n,
        amountIn: 100n,
        feePpm: 0n,
      });
      expect(out).toBe(2000n * 100n / (1000n + 100n)); // 181
      expect(out).toBe(181n);
    });

    it('恒定乘积公式正确性（含手续费 feePpm=3000）', () => {
      // amountInWithFee = 1000 * 997000 / 1e6 = 997
      // amountOut = 1e6 * 997 / (1e6 + 997) = 996
      const out = getAmountOutConstantProduct({
        reserveIn: 1_000_000n,
        reserveOut: 1_000_000n,
        amountIn: 1000n,
        feePpm: 3000n,
      });
      expect(out).toBe(996n);
    });

    it('amountIn<=0 抛错', () => {
      expect(() =>
        getAmountOutConstantProduct({
          reserveIn: 1000n,
          reserveOut: 1000n,
          amountIn: 0n,
          feePpm: 0n,
        }),
      ).toThrow();
      expect(() =>
        getAmountOutConstantProduct({
          reserveIn: 1000n,
          reserveOut: 1000n,
          amountIn: -1n,
          feePpm: 0n,
        }),
      ).toThrow();
    });

    it('reserve<=0 抛错', () => {
      expect(() =>
        getAmountOutConstantProduct({
          reserveIn: 0n,
          reserveOut: 1000n,
          amountIn: 100n,
          feePpm: 0n,
        }),
      ).toThrow();
    });

    it('feePpm 越界抛错', () => {
      expect(() =>
        getAmountOutConstantProduct({
          reserveIn: 1000n,
          reserveOut: 1000n,
          amountIn: 100n,
          feePpm: 1_000_000n,
        }),
      ).toThrow();
      expect(() =>
        getAmountOutConstantProduct({
          reserveIn: 1000n,
          reserveOut: 1000n,
          amountIn: 100n,
          feePpm: -1n,
        }),
      ).toThrow();
    });
  });

  // ---------- computePriceImpact / computePriceImpactFromSpot ----------
  describe('computePriceImpact', () => {
    it('正常值：1 - 90/100 = 0.1', () => {
      expect(
        computePriceImpact({
          amountIn: 100n,
          amountOut: 90n,
          midNum: 1n,
          midDen: 1n,
        }),
      ).toBe('0.1');
    });

    it('amountIn<=0 返回 0', () => {
      expect(
        computePriceImpact({
          amountIn: 0n,
          amountOut: 90n,
          midNum: 1n,
          midDen: 1n,
        }),
      ).toBe('0');
    });

    it('amountOut >= amountIn（无负向影响）返回 0', () => {
      expect(
        computePriceImpact({
          amountIn: 100n,
          amountOut: 100n,
          midNum: 1n,
          midDen: 1n,
        }),
      ).toBe('0');
    });
  });

  describe('computePriceImpactFromSpot', () => {
    it('正常值', () => {
      expect(
        computePriceImpactFromSpot({
          amountIn: 100n,
          amountOut: 90n,
          spotPriceNum: 1n,
          spotPriceDen: 1n,
        }),
      ).toBe('0.1');
    });

    it('amountIn<=0 返回 0', () => {
      expect(
        computePriceImpactFromSpot({
          amountIn: 0n,
          amountOut: 90n,
          spotPriceNum: 1n,
          spotPriceDen: 1n,
        }),
      ).toBe('0');
    });
  });

  // ---------- formatPrice ----------
  describe('formatPrice', () => {
    it('decimals 相同 → 直接比值', () => {
      expect(
        formatPrice(1_000_000_000_000_000_000n, 18, 1_000_000_000_000_000_000n, 18),
      ).toBe('1');
    });

    it('decimalsIn > decimalsOut（WETH→USDC，1 WETH = 2000 USDC）', () => {
      // amountIn = 1 WETH = 1e18，amountOut = 2000 USDC = 2000e6
      expect(formatPrice(10n ** 18n, 18, 2000n * 10n ** 6n, 6)).toBe('2000');
    });

    it('decimalsIn < decimalsOut（USDC→WETH，1 USDC = 0.0005 WETH）', () => {
      // amountIn = 2000 USDC = 2000e6，amountOut = 1 WETH = 1e18
      expect(formatPrice(2000n * 10n ** 6n, 6, 10n ** 18n, 18)).toBe('0.0005');
    });

    it('amountIn<=0 返回 0', () => {
      expect(formatPrice(0n, 18, 10n ** 18n, 18)).toBe('0');
    });
  });

  // ---------- parseDecimal ----------
  describe('parseDecimal', () => {
    it('正小数', () => {
      expect(parseDecimal('0.006')).toBe(6n * 10n ** 15n);
    });

    it('负小数', () => {
      expect(parseDecimal('-0.5')).toBe(-(5n * 10n ** 17n));
    });

    it('整数', () => {
      expect(parseDecimal('123')).toBe(123n * 10n ** 18n);
    });

    it('精度截断（超过 scale 位截断）', () => {
      expect(parseDecimal('1.2345678901234567890123456789')).toBe(
        1234567890123456789n,
      );
    });
  });

  // ---------- combinePriceImpacts ----------
  describe('combinePriceImpacts', () => {
    it('单跳', () => {
      expect(combinePriceImpacts(['0.1'])).toBe('0.1');
    });

    it('多跳组合：1 - (1-0.1)(1-0.1) = 0.19', () => {
      expect(combinePriceImpacts(['0.1', '0.1'])).toBe('0.19');
    });

    it('多跳组合：1 - (1-0.1)(1-0.2) = 0.28', () => {
      expect(combinePriceImpacts(['0.1', '0.2'])).toBe('0.28');
    });

    it('空数组返回 0', () => {
      expect(combinePriceImpacts([])).toBe('0');
    });
  });

  // ---------- maxAmountInConstantProduct ----------
  describe('maxAmountInConstantProduct', () => {
    const ONE = 10n ** 18n;
    const PPM = 1_000_000n;

    // 精确不等式：PI = (reserveIn*feePpm + F*x) / (reserveIn*PPM + F*x) ≤ thr（F=PPM-feePpm）
    function exactImpactLe(
      reserveIn: bigint,
      feePpm: bigint,
      x: bigint,
      thr: bigint,
    ): boolean {
      const f = PPM - feePpm;
      const n = reserveIn * feePpm + f * x;
      const d = reserveIn * PPM + f * x;
      return n * ONE <= thr * d;
    }

    it('反解出的 cap 精确满足不等式：cap 可行、cap+1 超限', () => {
      const cases = [
        { reserveIn: 1_000_000n, feePpm: 3000n, thr: 10n ** 16n },
        { reserveIn: 1_000_000_000n, feePpm: 500n, thr: 5n * 10n ** 15n },
        { reserveIn: 123_456_789n, feePpm: 3000n, thr: 2n * 10n ** 16n },
        { reserveIn: 10n ** 18n, feePpm: 3000n, thr: 10n ** 16n },
        { reserveIn: 5n * 10n ** 21n, feePpm: 3000n, thr: 10n ** 16n },
      ];
      for (const c of cases) {
        const cap = maxAmountInConstantProduct({
          reserveIn: c.reserveIn,
          feePpm: c.feePpm,
          threshold: c.thr,
        });
        expect(cap).toBeGreaterThan(0n);
        expect(exactImpactLe(c.reserveIn, c.feePpm, cap, c.thr)).toBe(true);
        expect(exactImpactLe(c.reserveIn, c.feePpm, cap + 1n, c.thr)).toBe(false);
      }
    });

    it('阈值 ≤ 费率时任何金额都超标 → 返回 0', () => {
      // fee 1%（10000 ppm）== 阈值 1%（0.01）
      expect(
        maxAmountInConstantProduct({
          reserveIn: 1_000_000n,
          feePpm: 10_000n,
          threshold: 10n ** 16n,
        }),
      ).toBe(0n);
      // fee 3%（30000 ppm）> 阈值 1%
      expect(
        maxAmountInConstantProduct({
          reserveIn: 1_000_000n,
          feePpm: 30_000n,
          threshold: 10n ** 16n,
        }),
      ).toBe(0n);
      // 阈值为 0
      expect(
        maxAmountInConstantProduct({
          reserveIn: 1_000_000n,
          feePpm: 3000n,
          threshold: 0n,
        }),
      ).toBe(0n);
    });

    it('reserveIn ≤ 0 返回 0', () => {
      expect(
        maxAmountInConstantProduct({
          reserveIn: 0n,
          feePpm: 3000n,
          threshold: 10n ** 16n,
        }),
      ).toBe(0n);
    });
  });

  // ---------- sqrtPriceX96ToMidPrice ----------
  describe('sqrtPriceX96ToMidPrice', () => {
    it('tokenInIsToken0=true：midNum=p, midDen=Q192', () => {
      const sqrt = 1n << 96n; // price = 1
      const r = sqrtPriceX96ToMidPrice(sqrt, true);
      expect(r.midNum).toBe(sqrt * sqrt);
      expect(r.midDen).toBe(Q192);
    });

    it('tokenInIsToken0=false：midNum=Q192, midDen=p', () => {
      const sqrt = (1n << 96n) * 2n; // price = 4
      const r = sqrtPriceX96ToMidPrice(sqrt, false);
      expect(r.midNum).toBe(Q192);
      expect(r.midDen).toBe(sqrt * sqrt);
    });

    it('price=1 时两分支 midNum===midDen', () => {
      const sqrt = 1n << 96n;
      const t0 = sqrtPriceX96ToMidPrice(sqrt, true);
      const t1 = sqrtPriceX96ToMidPrice(sqrt, false);
      expect(t0.midNum).toBe(Q192);
      expect(t0.midDen).toBe(Q192);
      expect(t1.midNum).toBe(Q192);
      expect(t1.midDen).toBe(Q192);
    });
  });
});
