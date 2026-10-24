import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('go', go);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

export interface CodeSegment {
  text: string;
  color?: string;
}

const scopeColorMap: Record<string, string | undefined> = {
  keyword: 'magenta',
  built_in: 'magenta',
  type: 'yellow',
  literal: 'yellow',
  number: 'yellow',
  string: 'green',
  'string.subst': 'green',
  regexp: 'green',
  title: 'blue',
  'title.function': 'blue',
  'title.class': 'cyan',
  attribute: 'yellow',
  params: 'white',
  comment: 'gray',
  doctag: 'gray',
  meta: 'gray',
  symbol: 'cyan',
  bullet: 'cyan',
  code: 'cyan',
  section: 'blue',
  'selector-attr': 'yellow',
  'selector-id': 'yellow',
  'selector-class': 'yellow',
  'selector-pseudo': 'magenta',
  subst: 'white',
  addition: 'green',
  deletion: 'red',
  emphasis: 'white',
  strong: 'white',
  quote: 'gray',
  variable: 'cyan',
  template_variable: 'cyan',
  property: 'yellow',
  operator: 'magenta',
};

function scopeToColor(scope: string): string | undefined {
  return scopeColorMap[scope] ?? undefined;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseHljsHtml(html: string): CodeSegment[] {
  const segments: CodeSegment[] = [];
  const stack: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.length === 0) return;
    const scope = stack.length > 0 ? stack[stack.length - 1] : 'plain';
    const color = scopeToColor(scope);
    const text = decodeEntities(buffer);
    const last = segments[segments.length - 1];
    if (last && last.color === color) {
      last.text += text;
    } else {
      segments.push({ text, color });
    }
    buffer = '';
  };

  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      flush();
      const end = html.indexOf('>', i);
      if (end === -1) {
        buffer += ch;
        i++;
        continue;
      }
      const tag = html.slice(i + 1, end);
      if (tag.startsWith('/span')) {
        stack.pop();
      } else if (/^span\b/.test(tag)) {
        const match = tag.match(/class="hljs-([\w-]+)"/);
        stack.push(match ? match[1] : 'plain');
      }
      i = end + 1;
    } else {
      buffer += ch;
      i++;
    }
  }
  flush();

  return segments;
}

export function highlightCode(code: string, language?: string): CodeSegment[] {
  const lang = language?.toLowerCase();
  if (!lang || !hljs.getLanguage(lang)) {
    return [{ text: code }];
  }
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    const parsed = parseHljsHtml(result.value);
    return parsed.length > 0 ? parsed : [{ text: code }];
  } catch {
    return [{ text: code }];
  }
}

export function splitSegmentsIntoLines(segments: CodeSegment[]): CodeSegment[][] {
  const lines: CodeSegment[][] = [[]];
  for (const seg of segments) {
    const parts = seg.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i].length > 0) {
        lines[lines.length - 1].push({ text: parts[i], color: seg.color });
      }
    }
  }
  return lines;
}
