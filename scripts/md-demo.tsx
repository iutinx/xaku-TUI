import React from 'react';
import { render } from 'ink-testing-library';
import { MarkdownText } from '../src/ui/MarkdownText.js';

const samples = [
  `The largest number up to $ n $ with the maximum number of divisors is a **highly composite number**. There's no simple closed-form formula for this, but highly composite numbers are typically products of small primes raised to decreasing exponents (e.g., $ 2^a \\cdot 3^b \\cdot 5^c \\cdots $ with $ a \\geq b \\geq c \\geq \\cdots $).`,
  `# Title\n\nA paragraph with \`inline code\` and a list:\n\n- item one\n- item **two**\n\n\`\`\`js\nfunction foo(x) {\n  return x * 2;\n}\n\`\`\``,
  `> a blockquote here\n\n1. first\n2. second`,
];

for (const [i, s] of samples.entries()) {
  console.log(`===== Sample ${i + 1} =====`);
  const { lastFrame } = render(React.createElement(MarkdownText, { content: s }));
  console.log(lastFrame());
  console.log();
}
