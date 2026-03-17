import { describe, it, expect } from 'vitest';
import { ProviderConfigError } from './types';

describe('ProviderConfigError', () => {
  it('carries the field name', () => {
    const err = new ProviderConfigError('API key is required', 'apiKey');
    expect(err.field).toBe('apiKey');
  });

  it('has the correct name property', () => {
    const err = new ProviderConfigError('Missing base URL', 'apiBase');
    expect(err.name).toBe('ProviderConfigError');
  });

  it('extends Error', () => {
    const err = new ProviderConfigError('Something went wrong', 'type');
    expect(err).toBeInstanceOf(Error);
  });

  it('carries the error message', () => {
    const msg = 'apiKey must not be empty';
    const err = new ProviderConfigError(msg, 'apiKey');
    expect(err.message).toBe(msg);
  });

  it('is itself an instance of ProviderConfigError', () => {
    const err = new ProviderConfigError('oops', 'type');
    expect(err).toBeInstanceOf(ProviderConfigError);
  });
});
