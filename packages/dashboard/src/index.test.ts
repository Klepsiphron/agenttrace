import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, VERSION } from './index.js';

describe('@agenttrace/dashboard', () => {
  it('exports the package version', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@agenttrace/dashboard');
  });
});
