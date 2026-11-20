import { describe, expect, it } from 'vitest';

describe('required quality check merge gate probe', () => {
  it('deliberately fails to verify main protection', () => {
    expect('CI failure probe').toBe('CI success');
  });
});
