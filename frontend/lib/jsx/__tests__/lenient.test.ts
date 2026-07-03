// sanitizeLooseJsx — HTML-ism tolerance for agent-authored markup. Agents write story bodies
// as HTML, not strict JSX; the common HTML-isms (comments, void tags, stray `<`) must not make
// an otherwise-correct document unparseable. The sanitizer never touches template-literal spans
// (SQL in query={`…`} / CSS in <style>{`…`}) and is only applied as a parse-failure retry.
import { describe, it, expect } from 'vitest';
import { sanitizeLooseJsx } from '../lenient';
import { parseJsx } from '../parse';

describe('sanitizeLooseJsx', () => {
  it('strips HTML comments', () => {
    const out = sanitizeLooseJsx('<div><!-- HERO: open on the finding --><h1>Hi</h1></div>');
    expect(out).not.toContain('<!--');
    expect(out).toContain('<h1>Hi</h1>');
    expect(parseJsx(out).ok).toBe(true);
  });

  it('self-closes HTML void tags (<br>, <img>, <hr>)', () => {
    const out = sanitizeLooseJsx('<div>line one<br>line two<hr><img src="/x.png" alt="x"></div>');
    expect(parseJsx(out).ok).toBe(true);
    expect(out).toContain('<br/>');
    expect(out).toContain('<img src="/x.png" alt="x"/>');
  });

  it('leaves already-self-closed void tags alone', () => {
    const src = '<div><br/><img src="/x.png" /></div>';
    expect(sanitizeLooseJsx(src)).toBe(src);
  });

  it('escapes a stray < in prose (sales < 100)', () => {
    const out = sanitizeLooseJsx('<p>churn was < 5% all year</p>');
    expect(out).toContain('&lt; 5%');
    expect(parseJsx(out).ok).toBe(true);
  });

  it('never touches template-literal spans (SQL with < and -- comments)', () => {
    const src = '<Question query={`SELECT * FROM t WHERE a < 5 -- keep <this> raw\n`} connection="duckdb" height="200px" />';
    expect(sanitizeLooseJsx(src)).toBe(src);
  });

  it('never touches CSS template literals in <style>', () => {
    const src = '<style>{`.s { width: 100%; } /* a < b */`}</style>';
    expect(sanitizeLooseJsx(src)).toBe(src);
  });

  it('sanitizes around template literals but not inside them', () => {
    const src = '<div><!-- note --><Question query={`SELECT 1 -- <raw>`} height="200px" /><p>x < y</p></div>';
    const out = sanitizeLooseJsx(src);
    expect(out).not.toContain('<!-- note -->');
    expect(out).toContain('SELECT 1 -- <raw>');
    expect(out).toContain('x &lt; y');
    expect(parseJsx(out).ok).toBe(true);
  });

  it('rescues a realistic story fragment with mixed HTML-isms', () => {
    const src = [
      '<div class="story-x">',
      '  <!-- HERO -->',
      '  <section>',
      '    <h1>Retention < 80% for the first time</h1>',
      '    <p>Line one<br>Line two</p>',
      '    <Question query={`SELECT r FROM m WHERE r < 0.8`} connection="duckdb" height="240px" />',
      '  </section>',
      '</div>',
    ].join('\n');
    expect(parseJsx(src).ok).toBe(false); // raw HTML-isms genuinely break strict JSX
    const out = sanitizeLooseJsx(src);
    expect(parseJsx(out).ok).toBe(true);
    expect(out).toContain('WHERE r < 0.8'); // SQL untouched
  });
});
