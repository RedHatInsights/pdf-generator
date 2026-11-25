import { usesStaticRender } from './staticRender';

describe('usesStaticRender', () => {
  it('is on unless the template opts out', () => {
    expect(usesStaticRender(undefined)).toBe(true);
    expect(usesStaticRender({})).toBe(true);
    expect(usesStaticRender({ staticRender: true })).toBe(true);
    expect(usesStaticRender({ staticRender: 'false' })).toBe(true);
    expect(usesStaticRender({ staticRender: false })).toBe(false);
  });
});
