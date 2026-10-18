import { createClient, streamCompletion } from '../src/ollama.js';
import { getToolDefinitions } from '../src/tools/executor.js';
import { validateToolCall, executeToolCall } from '../src/tools/executor.js';
import type { ToolContext } from '../src/tools/types.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

async function main() {
  // Create a test workspace
  const workspace = await mkdtemp(path.join(tmpdir(), 'xaku-tool-test-'));
  await writeFile(path.join(workspace, 'test.txt'), 'Hello from test file!');
  await mkdir(path.join(workspace, 'subdir'));
  
  console.log('Test workspace:', workspace);
  
  const client = createClient('http://localhost:11434/v1');
  const toolCtx: ToolContext = { workspace, maxResultBytes: 100000 };
  const toolDefs = getToolDefinitions();
  
  console.log('Available tools:', toolDefs.map(t => t.function.name).join(', '));
  console.log('\nAsking model to read test.txt...');
  
  const result = await streamCompletion(
    client,
    {
      model: 'qwen3:4b',
      messages: [{ 
        role: 'user', 
        content: 'Please read the file test.txt and tell me what it contains.' 
      }],
      temperature: 0.2,
      systemPrompt: 'You are a helpful assistant. Answer directly and concisely.',
      tools: toolDefs,
    },
    {
      onContent(content) {
        // Will show content after tool execution
      },
      onToolCallDelta(tc) {
        console.log(`Tool call delta: ${tc.function?.name || ''}`);
      },
    },
  );
  
  console.log('\nModel response:');
  console.log('Content:', result.content);
  console.log('Tool calls:', result.toolCalls.length);
  
  if (result.toolCalls.length > 0) {
    for (const tc of result.toolCalls) {
      const toolName = tc.function?.name || '';
      const args = tc.function?.arguments || '{}';
      console.log(`\nTool call: ${toolName}(${args})`);
      
      // Validate
      const validation = validateToolCall({
        id: tc.id || 'test',
        type: 'function',
        function: { name: toolName, arguments: args },
      });
      
      console.log('Validation:', validation.valid ? '✓' : `✗ ${validation.error}`);
      
      if (validation.valid) {
        // Execute
        const execResult = await executeToolCall(
          {
            id: tc.id || 'test',
            type: 'function',
            function: { name: toolName, arguments: args },
          },
          toolCtx,
        );
        
        console.log('Execution result:', execResult.output?.slice(0, 100) || execResult.error);
        
        // Send tool result back to model
        console.log('\nSending tool result back to model...');
        const finalResult = await streamCompletion(
          client,
          {
            model: 'qwen3:4b',
            messages: [
              { role: 'user', content: 'Please read the file test.txt and tell me what it contains.' },
              {
                role: 'assistant',
                content: result.content || null,
                tool_calls: [{
                  id: tc.id || 'test',
                  type: 'function',
                  function: { name: toolName, arguments: args },
                }],
              },
              {
                role: 'tool',
                tool_call_id: tc.id || 'test',
                content: execResult.output || execResult.error || '',
              },
            ],
            temperature: 0.2,
            systemPrompt: 'You are a helpful assistant. Answer directly and concisely.',
            tools: toolDefs,
          },
          {
            onContent(content) {
              process.stdout.write(content);
            },
          },
        );
        
        console.log('\n\nFinal response:', finalResult.content);
      }
    }
  }
  
  // Cleanup
  await rm(workspace, { recursive: true });
  console.log('\n✓ Tool integration test complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
