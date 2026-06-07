import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, VERSION } from './index.js';

describe('@agenttrace-io/cli', () => {
  it('exports the package version', () => {
    expect(VERSION).toBe('0.3.0');
  });

  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@agenttrace-io/cli');
  });
});
