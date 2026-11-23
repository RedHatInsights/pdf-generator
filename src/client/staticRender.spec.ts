import { createElement } from 'react';
import {
  renderStatically,
  renderToMarkup,
  usesStaticRender,
} from './staticRender';

describe('usesStaticRender', () => {
  it('is on unless the template opts out', () => {
    expect(usesStaticRender(undefined)).toBe(true);
    expect(usesStaticRender({})).toBe(true);
    expect(usesStaticRender({ staticRender: true })).toBe(true);
    expect(usesStaticRender({ staticRender: 'false' })).toBe(true);
    expect(usesStaticRender({ staticRender: false })).toBe(false);
  });
});

describe('renderToMarkup', () => {
  const Row = ({ name }: { name: string }) =>
    createElement('td', { title: name }, name);

  it('renders the template with its props', () => {
    expect(renderToMarkup(Row, { name: 'host-1' })).toBe(
      '<td title="host-1">host-1</td>',
    );
  });

  it('keeps markup found in report data as text', () => {
    const markup = renderToMarkup(Row, {
      name: '"><img src=x onerror="alert(1)"></td><script>alert(1)</script>',
    });

    expect(markup).not.toMatch(/<img|<script/);
    expect(markup.match(/<td/g)).toHaveLength(1);
  });
});

describe('renderStatically', () => {
  it('asks for the template to be mounted when it throws', () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('boom');
    };

    expect(renderStatically(Broken, {})).toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('static render failed'),
      expect.any(Error),
    );
    logged.mockRestore();
  });
});
