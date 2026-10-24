import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { cleanLatex, isMathLike, MarkdownText } from './MarkdownText.js';
import { highlightCode, splitSegmentsIntoLines } from './code-highlight.js';

describe('cleanLatex', () => {
  it('strips inline $ ... $ delimiters', () => {
    expect(cleanLatex('the largest number up to $ n $')).toBe('the largest number up to n');
  });

  it('strips display $$ ... $$ delimiters', () => {
    expect(cleanLatex('formula: $$ x^2 + y^2 = z^2 $$ done')).toBe('formula: x^2 + y^2 = z^2 done');
  });

  it('does not strip currency amounts', () => {
    expect(cleanLatex('costs $5 to $10 per unit')).toBe('costs $5 to $10 per unit');
  });

  it('strips math starting with a digit ($2π rh$)', () => {
    expect(cleanLatex('it\'s $2π rh$ here')).toBe("it's 2π rh here");
  });

  it('strips math with a mix of digits, letters, and parens', () => {
    expect(cleanLatex('surface area is $2π r(r + h)$ done')).toBe('surface area is 2π r(r + h) done');
  });

  it('strips the cylinder example from the report', () => {
    const input =
      'The formula for the total surface area of a cylinder is $2π r(r + h), whereris the radius andh$ is the height.';
    const output = cleanLatex(input);
    expect(output).not.toContain('$');
    expect(output).toContain('2π r(r + h)');
  });

  it('strips $...$ that spans a single soft-wrap newline', () => {
    const input = 'area is $2π r(r + h), where r is\n the radius and h$ done';
    const output = cleanLatex(input);
    expect(output).not.toContain('$');
    expect(output).toContain('2π r(r + h)');
  });

  it('does not strip currency that spans a newline', () => {
    const input = 'costs $5 to\n $10 each';
    const output = cleanLatex(input);
    expect(output).toContain('$5');
    expect(output).toContain('$10');
  });

  it('does not strip $ across blank-line paragraph breaks', () => {
    const input = 'a math var $x$ here\n\nthen $y$ there';
    const output = cleanLatex(input);
    expect(output).toContain('x');
    expect(output).toContain('y');
    expect(output).not.toMatch(/\$x\$/);
  });

  it('does not strip $1,234.56 style currency', () => {
    expect(cleanLatex('price is $1,234.56 each')).toBe('price is $1,234.56 each');
  });

  it('replaces \\cdot with ·', () => {
    expect(cleanLatex('2 \\cdot 3')).toBe('2 · 3');
  });

  it('replaces \\geq with ≥', () => {
    expect(cleanLatex('a \\geq b')).toBe('a ≥ b');
  });

  it('replaces \\times with ×', () => {
    expect(cleanLatex('3 \\times 4')).toBe('3 × 4');
  });

  it('replaces \\frac{a}{b} with (a)/(b)', () => {
    expect(cleanLatex('\\frac{1}{2}')).toBe('(1)/(2)');
  });

  it('replaces greek letters', () => {
    expect(cleanLatex('\\alpha + \\beta = \\gamma')).toBe('α + β = γ');
  });

  it('handles the example from the report', () => {
    const input =
      'products of small primes raised to decreasing exponents (e.g., $ 2^a \\cdot 3^b \\cdot 5^c \\cdots $ with $ a \\geq b \\geq c \\geq \\cdots $)';
    const output = cleanLatex(input);
    expect(output).toContain('·');
    expect(output).toContain('≥');
    expect(output).not.toContain('$');
    expect(output).not.toContain('\\cdot');
    expect(output).not.toContain('\\geq');
  });

  it('leaves plain text unchanged', () => {
    expect(cleanLatex('hello world')).toBe('hello world');
  });
});

describe('isMathLike', () => {
  it('detects single-letter variables', () => {
    expect(isMathLike('n')).toBe(true);
    expect(isMathLike('r')).toBe(true);
  });

  it('detects formulas starting with digits', () => {
    expect(isMathLike('2π rh')).toBe(true);
    expect(isMathLike('2π r(r + h)')).toBe(true);
  });

  it('detects LaTeX commands', () => {
    expect(isMathLike('\\frac{1}{2}')).toBe(true);
  });

  it('rejects plain currency amounts', () => {
    expect(isMathLike('5')).toBe(false);
    expect(isMathLike('1,234.56')).toBe(false);
  });

  it('rejects digits and spaces only', () => {
    expect(isMathLike('100')).toBe(false);
  });
});


describe('highlightCode', () => {
  it('highlights javascript keywords in magenta', () => {
    const segments = highlightCode('const x = 1;', 'js');
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.some((s) => s.color === 'magenta')).toBe(true);
    expect(segments.some((s) => s.color === 'yellow')).toBe(true); // number
  });

  it('returns plain segment for unknown language', () => {
    const segments = highlightCode('hello world', 'madeup');
    expect(segments).toEqual([{ text: 'hello world' }]);
  });

  it('returns plain segment when no language is provided', () => {
    const segments = highlightCode('hello world');
    expect(segments).toEqual([{ text: 'hello world' }]);
  });

  it('handles multi-line python code', () => {
    const code = 'def foo():\n    return 42';
    const segments = highlightCode(code, 'python');
    const joined = segments.map((s) => s.text).join('');
    expect(joined).toBe(code);
    expect(segments.some((s) => s.color === 'magenta')).toBe(true);
  });

  it('handles bash strings and comments', () => {
    const segments = highlightCode('# comment\necho "hello"', 'bash');
    expect(segments.some((s) => s.color === 'gray')).toBe(true); // comment
    expect(segments.some((s) => s.color === 'green')).toBe(true); // string
  });
});

describe('splitSegmentsIntoLines', () => {
  it('splits a single segment on newlines', () => {
    const lines = splitSegmentsIntoLines([{ text: 'a\nb\nc', color: 'green' }]);
    expect(lines).toEqual([
      [{ text: 'a', color: 'green' }],
      [{ text: 'b', color: 'green' }],
      [{ text: 'c', color: 'green' }],
    ]);
  });

  it('preserves segments that do not span lines', () => {
    const lines = splitSegmentsIntoLines([
      { text: 'foo', color: 'magenta' },
      { text: ' bar' },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { text: 'foo', color: 'magenta' },
      { text: ' bar' },
    ]);
  });

  it('preserves color when a segment crosses a newline', () => {
    const lines = splitSegmentsIntoLines([
      { text: 'a\nb', color: 'green' },
      { text: 'x', color: 'magenta' },
    ]);
    expect(lines).toEqual([
      [{ text: 'a', color: 'green' }],
      [{ text: 'b', color: 'green' }, { text: 'x', color: 'magenta' }],
    ]);
  });

  it('returns empty inner array for trailing newline', () => {
    const lines = splitSegmentsIntoLines([{ text: 'a\n' }]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual([]);
  });
});

describe('<MarkdownText />', () => {
  it('renders a plain paragraph', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: 'Hello world.' }),
    );
    expect(lastFrame()).toContain('Hello world.');
  });

  it('renders bold text without asterisks', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: 'This is **bold**.' }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('bold');
    expect(out).not.toContain('**');
  });

  it('renders inline code without backticks', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: 'Use `npm test` now.' }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('npm test');
    expect(out).not.toContain('`npm test`');
  });

  it('renders a code block with a left border and content', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, {
        content: '```js\nconst x = 1;\n```',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('const');
    expect(out).toContain('│');
    expect(out).toContain('js');
  });

  it('renders a heading with prefix', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: '# Title' }),
    );
    expect(lastFrame()).toContain('# Title');
  });

  it('renders a list with bullets', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: '- one\n- two' }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('•');
    expect(out).toContain('one');
    expect(out).toContain('two');
  });

  it('renders ordered list with numbers', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: '1. first\n2. second' }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('1.');
    expect(out).toContain('first');
  });

  it('strips LaTeX $...$ when rendering', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, {
        content: 'the largest number up to $ n $ is highly composite.',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('n');
    expect(out).not.toContain('$ n $');
  });

  it('renders LaTeX with greek and math symbols', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, {
        content: 'products $ 2^a \\cdot 3^b \\cdot 5^c \\cdots $ with $ a \\geq b $',
      }),
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('·');
    expect(out).toContain('≥');
    expect(out).not.toContain('\\cdot');
    expect(out).not.toContain('$');
  });

  it('handles empty content', () => {
    const { lastFrame } = render(
      React.createElement(MarkdownText, { content: '' }),
    );
    expect(lastFrame()).toBeDefined();
  });
});
