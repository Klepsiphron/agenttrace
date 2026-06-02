import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, VERSION } from './index.js';

describe('@agenttrace/sdk', () => {
  it('exports the package version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('exports the package name', () => {
    expect(PACKAGE_NAME).toBe('@agenttrace/sdk');
  });
});
