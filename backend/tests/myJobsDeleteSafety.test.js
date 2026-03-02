const Application = require('../models/Application');

describe('my jobs delete safety', () => {
  it('enforces unique application identity per worker/job pair', () => {
    const indexes = Application.schema.indexes();
    const uniquePair = indexes.find(([spec, opts]) => spec.job === 1 && spec.worker === 1 && opts?.unique === true);
    expect(uniquePair).toBeTruthy();
  });
});
