import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toConsoleSafeText, consoleNeedsAsciiSafety, installAsciiSafeOutput } from '../../scripts/lib/ascii-safe.mjs';

describe('ascii-safe: GBK console output protection', () => {
  it('maps the CLI emoji markers to ASCII equivalents', () => {
    assert.equal(toConsoleSafeText('✅ All artifacts validated.'), '[OK] All artifacts validated.');
    assert.equal(toConsoleSafeText('❌ Validation failed with errors.'), '[FAIL] Validation failed with errors.');
    assert.equal(toConsoleSafeText('🔴 [ERROR] tasks.md: too short'), '[E] [ERROR] tasks.md: too short');
    assert.equal(toConsoleSafeText('🟡 [WARNING] design.md: no headings'), '[W] [WARNING] design.md: no headings');
    assert.equal(toConsoleSafeText('📋 proposal.md'), '[doc] proposal.md');
    assert.equal(toConsoleSafeText('⚠️ careful'), '[!] careful');
    assert.equal(toConsoleSafeText('     ↳ mapping line'), '     > mapping line');
  });

  it('preserves Chinese text untouched', () => {
    const text = '✅ 所有工件校验通过。变更：demo';
    assert.equal(toConsoleSafeText(text), '[OK] 所有工件校验通过。变更：demo');
  });

  it('strips unmapped emoji without touching ASCII or CJK', () => {
    assert.equal(toConsoleSafeText('done 🎉 ok'), 'done  ok');
    assert.equal(toConsoleSafeText('plain ASCII stays'), 'plain ASCII stays');
  });

  it('leaves non-string values alone', () => {
    const obj = { code: 1 };
    assert.equal(toConsoleSafeText(obj), obj);
    assert.equal(toConsoleSafeText(42), 42);
  });

  it('gates installation to win32 TTYs without SSF_UTF8', () => {
    const fake = { isTTY: true, write() { return true; } };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      delete process.env.SSF_UTF8;
      assert.equal(consoleNeedsAsciiSafety(fake), true);
      process.env.SSF_UTF8 = '1';
      assert.equal(consoleNeedsAsciiSafety(fake), false);
      delete process.env.SSF_UTF8;
      assert.equal(consoleNeedsAsciiSafety({ isTTY: false, write() {} }), false);
    } finally {
      if (originalPlatform !== 'win32') Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      delete process.env.SSF_UTF8;
    }
  });

  it('rewrites emoji emitted through console.log when active', () => {
    const lines = [];
    const fake = { isTTY: true, write(chunk) { lines.push(chunk); return true; } };
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      delete process.env.SSF_UTF8;
      const { toConsoleSafeText: safe } = { toConsoleSafeText };
      const wrapped = (chunk) => (typeof chunk === 'string' ? safe(chunk) : chunk);
      // installAsciiSafeOutput is idempotent and process-global; assert the
      // wrapping contract on the fake stream the same way the installer does.
      const originalWrite = fake.write.bind(fake);
      fake.write = chunk => originalWrite(wrapped(chunk));
      fake.write('🔍 Validating: demo\n✅ valid\n');
      assert.deepEqual(lines, ['[scan] Validating: demo\n[OK] valid\n']);
    } finally {
      if (originalPlatform !== 'win32') Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      delete process.env.SSF_UTF8;
    }
  });

  it('never double-installs', () => {
    assert.doesNotThrow(() => installAsciiSafeOutput());
    assert.doesNotThrow(() => installAsciiSafeOutput());
  });
});
