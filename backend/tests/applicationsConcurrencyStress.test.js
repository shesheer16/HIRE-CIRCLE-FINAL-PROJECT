const Application = require('../models/Application');

describe('applications concurrency stress', () => {
  it('keeps anti-duplication composite index for parallel apply requests', () => {
    const indexes = Application.schema.indexes();
    const hasUnique = indexes.some(([spec, opts]) => spec.job === 1 && spec.worker === 1 && opts?.unique === true);
    expect(hasUnique).toBe(true);
  });
});
