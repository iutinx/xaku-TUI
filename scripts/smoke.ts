import { createClient, streamCompletion } from '../src/model/ollama.js';

async function main() {
  const client = createClient('http://localhost:11434/v1');
  process.stdout.write('Model: qwen3:4b\nResponse: ');
  const result = await streamCompletion(
    client,
    {
      model: 'qwen3:4b',
      messages: [{ role: 'user', content: 'Say hi.' }],
      temperature: 0.2,
      systemPrompt: 'You are a helpful assistant. Answer directly and concisely.',
    },
    {
      onContent(content) {
        process.stdout.write(content);
      },
      onUsage(usage) {
        console.log('\nUsage:', usage);
      },
    },
  );
  console.log('\nResult content:', JSON.stringify(result.content));
  console.log('Smoke test complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
