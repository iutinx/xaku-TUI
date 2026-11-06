import { Box, Text } from 'ink';
import React from 'react';
import { marked } from 'marked';
import { highlightCode, splitSegmentsIntoLines, type CodeSegment } from './code-highlight.js';
import { theme } from './theme.js';

export interface MarkdownTextProps {
  content: string;
}

type AnyToken = { type: string; [key: string]: unknown };

/**
 * Make partially-streamed markdown safe to lex by closing dangling constructs:
 * unclosed code fences, inline code, bold/strikethrough markers, and link
 * parens. Applied only during streaming; complete messages render raw content.
 */
export function preprocessStreaming(text: string): string {
  if (!text) return text;
  let out = text;

  // Odd number of fence-opening lines => last block is still open.
  const fences = out.match(/^`{3,}[^\n]*/gm) ?? [];
  if (fences.length % 2 === 1) {
    out += '\n```';
  }

  // Strip complete fenced and inline code spans, then count dangling markers.
  const outside = out.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const count = (s: string, sub: string) => s.split(sub).length - 1;

  if (count(outside, '`') % 2 === 1) out += '`';
  if (count(outside, '**') % 2 === 1) out += '**';
  if (count(outside, '~~') % 2 === 1) out += '~~';
  if (/\]\([^)]*$/.test(out)) out += ')';

  return out;
}

const latexCommandMap: Record<string, string> = {
  cdot: '·',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  hdots: '⋯',
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  geq: '≥',
  ge: '≥',
  leq: '≤',
  le: '≤',
  neq: '≠',
  ne: '≠',
  sim: '∼',
  simeq: '≃',
  approx: '≈',
  equiv: '≡',
  propto: '∝',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  emptyset: '∅',
  varnothing: '∅',
  in: '∈',
  notin: '∉',
  ni: '∋',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  oplus: '⊕',
  otimes: '⊗',
  perp: '⊥',
  parallel: '∥',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  mapsto: '↦',
  implies: '⟹',
  iff: '⟺',
  angle: '∠',
  degree: '°',
  prime: '′',
  sum: 'Σ',
  prod: 'Π',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  therefore: '∴',
  because: '∵',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'ϕ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  ell: 'ℓ',
  hbar: 'ℏ',
  Re: 'ℜ',
  Im: 'ℑ',
  aleph: 'ℵ',
  beth: 'ℶ',
  circ: '∘',
  bullet: '∙',
  star: '⋆',
  ast: '*',
  diamond: '⋄',
  square: '□',
  triangle: '△',
  bigtriangleup: '△',
  bigtriangledown: '▽',
  lceil: '⌈',
  rceil: '⌉',
  lfloor: '⌊',
  rfloor: '⌋',
  langle: '⟨',
  rangle: '⟩',
  checkmark: '✓',
  male: '♂',
  female: '♀',
  top: '⊤',
  bot: '⊥',
  models: '⊨',
  vdash: '⊢',
};

export function isMathLike(inner: string): boolean {
  const s = inner.trim();
  if (!s) return false;
  if (/^[0-9,.\s\-+$/]+$/.test(s)) return false;
  if (/[πθφψωαβγδεζηικλμνξοπρστυχψωϑϖΑΒΓΔΘΛΞΠΣΦΨΩ·×÷≥≤≠±∓∞∑∏∫√∂∇∈∉∀∃∪∩→←↔⇒⋯…^]/.test(s)) return true;
  if (/\\[a-zA-Z]/.test(s)) return true;
  if (/\([^)]*[+\-*/=<>][^)]*\)/.test(s)) return true;
  if (/^[a-zA-Z]$/.test(s)) return true;
  if (/^[a-zA-Z]{2}$/.test(s) && !/(to|of|in|is|an|on|or|by|as|at|we|he|it|do|so|no|up|if|my|me|be)/.test(s)) return true;
  return false;
}

export function cleanLatex(text: string): string {
  let out = text;
  out = out.replace(/\$\$([^$]+?)\$\$/g, (match, inner: string) => {
    const trimmed = inner.trim();
    return isMathLike(trimmed) ? trimmed : match;
  });
  out = out.replace(/\$((?:[^$\n]|\n(?!\n))+?)\$/g, (match, inner: string) => {
    const trimmed = inner.trim();
    return isMathLike(trimmed) ? trimmed : match;
  });
  out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|mathtt|operatorname)\{([^{}]*)\}/g, '$1');
  out = out.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b/g, '');
  out = out.replace(/\\,/g, ' ');
  out = out.replace(/\\;/g, ' ');
  out = out.replace(/\\:/g, ' ');
  out = out.replace(/\\ /g, ' ');
  out = out.replace(/\\([a-zA-Z]+)/g, (match, name: string) => {
    const replacement = latexCommandMap[name];
    return replacement !== undefined ? replacement : match;
  });
  out = out.replace(/\\/g, '');
  return out;
}

export function MarkdownText({ content }: MarkdownTextProps) {
  const tokens = React.useMemo(() => {
    try {
      return marked.lexer(content) as unknown as AnyToken[];
    } catch {
      return [];
    }
  }, [content]);

  return (
    <Box flexDirection="column" gap={1}>
      {tokens.map((token, i) => (
        <BlockToken key={i} token={token} />
      ))}
    </Box>
  );
}

function BlockToken({ token }: { token: AnyToken }) {
  switch (token.type) {
    case 'space':
      return null;
    case 'heading':
      return <HeadingToken token={token} />;
    case 'code':
      return <CodeBlockToken token={token} />;
    case 'hr':
      return (
        <Box>
          <Text color={theme.muted}>{'─'.repeat(40)}</Text>
        </Box>
      );
    case 'blockquote':
      return <BlockquoteToken token={token} />;
    case 'list':
      return <ListToken token={token} />;
    case 'table':
      return <TableToken token={token} />;
    case 'html':
      return null;
    case 'paragraph':
      return (
        <Box>
          <Text wrap="wrap">{renderInline((token.tokens as AnyToken[]) ?? [])}</Text>
        </Box>
      );
    case 'text': {
      const children = token.tokens as AnyToken[] | undefined;
      if (children && Array.isArray(children)) {
        return (
          <Box>
            <Text wrap="wrap">{renderInline(children)}</Text>
          </Box>
        );
      }
      return (
        <Box>
          <Text wrap="wrap">{cleanLatex(String(token.text ?? ''))}</Text>
        </Box>
      );
    }
    default:
      return null;
  }
}

function HeadingToken({ token }: { token: AnyToken }) {
  const depth = Number(token.depth ?? 1);
  const children = (token.tokens as AnyToken[]) ?? [];
  return (
    <Box>
      <Text bold color={theme.primary}>{`${'#'.repeat(depth)} `}</Text>
      <Text bold color={theme.primary} wrap="wrap">
        {renderInline(children)}
      </Text>
    </Box>
  );
}

function CodeBlockToken({ token }: { token: AnyToken }) {
  const code = String(token.text ?? '');
  const lang = token.lang ? String(token.lang) : undefined;
  const lines = React.useMemo(() => {
    const segments = highlightCode(code, lang);
    return splitSegmentsIntoLines(segments);
  }, [code, lang]);

  return (
    <Box flexDirection="column">
      {lang && (
        <Text color={theme.muted} dimColor>
          {`[ ${lang} ]`}
        </Text>
      )}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderRight={false}
        borderBottom={false}
        paddingLeft={1}
        borderColor="gray"
      >
        {lines.map((line, i) => (
          <Text key={i} wrap="wrap">
            {renderSegments(line)}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function renderSegments(segments: CodeSegment[]): React.ReactNode {
  return segments.map((seg, i) => (
    <Text key={i} color={seg.color}>
      {seg.text}
    </Text>
  ));
}

function BlockquoteToken({ token }: { token: AnyToken }) {
  const children = (token.tokens as AnyToken[]) ?? [];
  return (
    <Box
      flexDirection="column"
      marginLeft={1}
      borderStyle="single"
      borderLeft
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
      borderColor="gray"
    >
      {children.map((child, i) => (
        <BlockTokenFlat key={i} token={child} />
      ))}
    </Box>
  );
}

function BlockTokenFlat({ token }: { token: AnyToken }) {
  if (token.type === 'space') return null;
  if (token.type === 'paragraph' || token.type === 'text') {
    const children = (token.tokens as AnyToken[]) ?? [];
    if (children.length > 0) {
      return (
        <Text wrap="wrap">{renderInline(children)}</Text>
      );
    }
    return <Text wrap="wrap">{cleanLatex(String(token.text ?? ''))}</Text>;
  }
  if (token.type === 'list') return <ListToken token={token} />;
  if (token.type === 'code') return <CodeBlockToken token={token} />;
  if (token.type === 'blockquote') return <BlockquoteToken token={token} />;
  if (token.type === 'heading') return <HeadingToken token={token} />;
  return null;
}

function ListToken({ token }: { token: AnyToken }) {
  const ordered = Boolean(token.ordered);
  const start = Number(token.start) || 1;
  const items = (token.items as AnyToken[]) ?? [];
  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <ListItem key={i} item={item} index={i} ordered={ordered} start={start} />
      ))}
    </Box>
  );
}

function ListItem({
  item,
  index,
  ordered,
  start,
}: {
  item: AnyToken;
  index: number;
  ordered: boolean;
  start: number;
}) {
  const children = (item.tokens as AnyToken[]) ?? [];
  const bullet = ordered ? `${start + index}. ` : '• ';
  const task = Boolean(item.task);
  const checked = Boolean(item.checked);
  const taskMark = task ? (checked ? '[x] ' : '[ ] ') : '';

  return (
    <Box>
      <Text color={theme.primary}>{bullet}</Text>
      <Box flexDirection="column" flexGrow={1}>
        {taskMark && <Text color={theme.muted}>{taskMark}</Text>}
        {children.map((child, i) => {
          if (child.type === 'text') {
            const nested = child.tokens as AnyToken[] | undefined;
            if (nested && Array.isArray(nested)) {
              return <Text key={i} wrap="wrap">{renderInline(nested)}</Text>;
            }
            return <Text key={i} wrap="wrap">{cleanLatex(String(child.text ?? ''))}</Text>;
          }
          return <BlockToken key={i} token={child} />;
        })}
      </Box>
    </Box>
  );
}

function TableToken({ token }: { token: AnyToken }) {
  const header = (token.header as Array<{ text: string; tokens?: AnyToken[] }>) ?? [];
  const rows = (token.rows as Array<Array<{ text: string; tokens?: AnyToken[] }>>) ?? [];
  const headerCells = header.map((h) => h.text);
  const rowCells = rows.map((row) => row.map((cell) => cell.text));
  const widths = headerCells.map((_, i) => {
    const values = [headerCells[i], ...rowCells.map((r) => r[i] ?? '')];
    return Math.max(1, ...values.map((v) => v.length));
  });

  const renderRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join(' │ ');

  return (
    <Box flexDirection="column">
      <Text bold color={theme.primary}>{renderRow(headerCells)}</Text>
      <Text color={theme.muted}>{widths.map((w) => '─'.repeat(w)).join('─┼─')}</Text>
      {rowCells.map((row, i) => (
        <Text key={i} wrap="wrap">{renderRow(row)}</Text>
      ))}
    </Box>
  );
}

function renderInline(tokens: AnyToken[]): React.ReactNode {
  return tokens.map((token, i) => renderInlineToken(token, i));
}

function renderInlineToken(token: AnyToken, key: number): React.ReactNode {
  switch (token.type) {
    case 'strong':
      return (
        <Text key={key} bold>
          {renderInline((token.tokens as AnyToken[]) ?? [])}
        </Text>
      );
    case 'em':
      return (
        <Text key={key} italic>
          {renderInline((token.tokens as AnyToken[]) ?? [])}
        </Text>
      );
    case 'del':
      return (
        <Text key={key} strikethrough>
          {renderInline((token.tokens as AnyToken[]) ?? [])}
        </Text>
      );
    case 'codespan':
      return (
        <Text key={key} color="cyan">{String(token.text ?? '')}</Text>
      );
    case 'br':
      return <Text key={key}>{'\n'}</Text>;
    case 'link': {
      const inner = (token.tokens as AnyToken[]) ?? [];
      return (
        <Text key={key}>
          {renderInline(inner)}
          <Text color={theme.muted}>{` (${String(token.href ?? '')})`}</Text>
        </Text>
      );
    }
    case 'image':
      return (
        <Text key={key} color={theme.muted}>
          {`[image: ${String(token.text ?? token.alt ?? '')}]`}
        </Text>
      );
    case 'escape':
      return <Text key={key}>{String(token.text ?? '')}</Text>;
    case 'html':
      return null;
    case 'text': {
      const nested = token.tokens as AnyToken[] | undefined;
      if (nested && Array.isArray(nested) && nested.length > 0) {
        return <React.Fragment key={key}>{renderInline(nested)}</React.Fragment>;
      }
      return <Text key={key}>{cleanLatex(String(token.text ?? ''))}</Text>;
    }
    default:
      return <Text key={key}>{cleanLatex(String((token as { text?: unknown }).text ?? ''))}</Text>;
  }
}
