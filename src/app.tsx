import { Box, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Config } from './config.js';
import {
  checkToolSupport,
  createClient,
  listInstalledModels,
  streamCompletion,
  type ToolCallInProgress,
} from './ollama.js';
import { parseCommand } from './commands.js';
import { estimateContextTokens, estimateTokens, type ConversationMessage, type UserMessage } from './session.js';
import { createLogger } from './logger.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { InputLine } from './ui/InputLine.js';
import { StatsBar } from './ui/StatsBar.js';
import { TopBar } from './ui/TopBar.js';
import { ToolPanel } from './ui/ToolPanel.js';
import type { ToolActivity } from './ui/ToolActivity.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from './tools/executor.js';
import type { ToolContext } from './tools/types.js';

export interface AppProps {
  config: Config;
}

export default function App({ config }: AppProps) {
  const client = useMemo(() => createClient(config.baseUrl), [config.baseUrl]);
  const logger = useMemo(
    () =>
      createLogger(config, {
        model: config.model,
        temperature: config.temperature,
        systemPrompt: config.systemPrompt,
        workspace: config.workspace,
        baseUrl: config.baseUrl,
      }),
    [config],
  );

  const [model, setModel] = useState(config.model ?? '');
  const [temperature, setTemperature] = useState(config.temperature);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(config.systemPrompt);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partial, setPartial] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const [stats, setStats] = useState({
    generatedTokens: 0,
    generationStart: null as number | null,
    toolSuccess: 0,
    toolFail: 0,
  });

  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([]);
  const [pendingApproval, setPendingApproval] = useState<string | null>(null); // activity id awaiting approval

  const toolCallsRef = useRef<ToolCallInProgress[]>([]);
  const generatedTokensRef = useRef(0);

  const contextTokens = useMemo(
    () => estimateContextTokens(messages, systemPrompt, partial),
    [messages, systemPrompt, partial],
  );

  const tokensPerSecond = useMemo(() => {
    if (!generating || !stats.generationStart || stats.generatedTokens === 0) return 0;
    const elapsed = (Date.now() - stats.generationStart) / 1000;
    return elapsed > 0 ? stats.generatedTokens / elapsed : 0;
  }, [generating, stats.generationStart, stats.generatedTokens, partial]);

  useEffect(() => {
    testConnection();
  }, [client]);

  // Pin the root box to the live terminal height. Ink resolves height="100%"
  // against no containing block (it collapses to auto), so the frame was shorter
  // than the screen and Ink's line-count diff renderer left stale/duplicated
  // rows after terminal reflow. With frame height >= rows, Ink takes its
  // clearTerminal + full repaint path instead, and the layout fills the screen.
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(() => stdout?.rows ?? 24);
  useEffect(() => {
    const onResize = () => setTermRows(stdout?.rows ?? 24);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  async function testConnection() {
    try {
      const models = await listInstalledModels(config.baseUrl);
      setConnected(true);
      setChecking(false);
      setError(null);
      if (models.length === 0) {
        addSystemMessage('No models installed. Run: ollama pull qwen3:4b');
        return models;
      }
      const installedNames = models.map((m) => m.name);
      let activeModel = model;
      if (!activeModel) {
        // Nothing explicitly configured: use the first installed model quietly.
        activeModel = installedNames[0];
        setModel(activeModel);
        logger.log({ event: 'set_model', model: activeModel, reason: 'auto' });
      } else if (!installedNames.includes(activeModel)) {
        const fallback = installedNames[0];
        addSystemMessage(`Model "${activeModel}" is not installed. Switched to ${fallback}. Use /model <name> to change.`);
        activeModel = fallback;
        setModel(fallback);
        logger.log({ event: 'set_model', model: fallback, reason: 'fallback' });
      }
      try {
        const supportsTools = await checkToolSupport(config.baseUrl, activeModel);
        if (!supportsTools) {
          addSystemMessage(`Warning: ${activeModel} does not advertise tool support. Tool calls may fail.`);
        }
      } catch {
        // Tool-support check is best-effort; do not mark the server disconnected.
      }
      return models;
    } catch {
      setConnected(false);
      setChecking(false);
      setError(`Cannot reach Ollama at ${config.baseUrl}. Start Ollama, then press Enter to retry.`);
      return [];
    }
  }

  const hasFailedTool = toolActivities.some((a) => a.status === 'failed');
  const hasToolPrompt = pendingApproval !== null || hasFailedTool;
  const connectionError = !!error && error.includes('press Enter to retry');

  // Global keys are ONLY active while a tool prompt or connection retry is pending,
  // so normal typing/backspace always goes to the InputLine.
  useInput(
    (char, key) => {
      if (pendingApproval) {
        if (char === 'a') {
          approveToolCall(pendingApproval);
          return;
        }
        if (char === 'd') {
          denyToolCall(pendingApproval);
          return;
        }
      }

      if (hasFailedTool) {
        const failedActivity = toolActivities.find((a) => a.status === 'failed');
        if (failedActivity) {
          if (char === 'f') {
            fixToolCall(failedActivity.id);
            return;
          }
          if (char === 's') {
            skipToolCall(failedActivity.id);
            return;
          }
          if (char === 'r') {
            retryToolCall(failedActivity.id);
            return;
          }
        }
      }

      if (key.return && connectionError) {
        setError(null);
        testConnection();
      }
    },
    { isActive: hasToolPrompt || connectionError },
  );

  function addSystemMessage(content: string) {
    setMessages((prev) => [...prev, { role: 'system', content }]);
  }

  // Tool approval handlers
  const approvalResolvers = useRef<Map<string, (approved: boolean) => void>>(new Map());

  function approveToolCall(activityId: string) {
    const resolver = approvalResolvers.current.get(activityId);
    if (resolver) {
      resolver(true);
      approvalResolvers.current.delete(activityId);
    }
    setPendingApproval(null);
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'approved' } : a)),
    );
  }

  function denyToolCall(activityId: string) {
    const resolver = approvalResolvers.current.get(activityId);
    if (resolver) {
      resolver(false);
      approvalResolvers.current.delete(activityId);
    }
    setPendingApproval(null);
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'denied' } : a)),
    );
  }

  function fixToolCall(activityId: string) {
    // For now, just mark as skipped - in future could allow editing
    skipToolCall(activityId);
  }

  function skipToolCall(activityId: string) {
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'skipped' } : a)),
    );
  }

  function retryToolCall(activityId: string) {
    // Re-run the tool call
    const activity = toolActivities.find((a) => a.id === activityId);
    if (activity) {
      executeToolActivity(activity);
    }
  }

  async function executeToolActivity(activity: ToolActivity) {
    const startTime = Date.now();
    
    // Show as running
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activity.id ? { ...a, status: 'running', startTime } : a)),
    );

    const toolCtx: ToolContext = {
      workspace: config.workspace,
      maxResultBytes: config.maxResultBytes,
    };

    const result = await executeToolCall(
      {
        id: activity.toolCallId,
        type: 'function',
        function: {
          name: activity.toolName,
          arguments: JSON.stringify(activity.arguments),
        },
      },
      toolCtx,
    );

    const duration = (Date.now() - startTime) / 1000;

    if (result.error) {
      setToolActivities((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? {
                ...a,
                status: 'failed',
                error: result.error,
                errorLabel: result.label,
                duration,
              }
            : a,
        ),
      );
      setStats((s) => ({ ...s, toolFail: s.toolFail + 1 }));
      logger.log({
        event: 'tool_error',
        tool: activity.toolName,
        args: activity.arguments,
        error: result.error,
        label: result.label,
        duration,
      });
    } else {
      setToolActivities((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, status: 'success', result: result.output, duration, trimmed: result.trimmed }
            : a,
        ),
      );
      setStats((s) => ({ ...s, toolSuccess: s.toolSuccess + 1 }));
      logger.log({
        event: 'tool_success',
        tool: activity.toolName,
        args: activity.arguments,
        duration,
        trimmed: result.trimmed,
      });
    }

    return result;
  }

  async function handleSubmit(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setInput('');

    if (value.startsWith('/')) {
      logger.log({ event: 'command', command: value });
      const action = parseCommand(value);
      switch (action.type) {
        case 'clear':
          setMessages([]);
          setPartial('');
          setError(null);
          logger.log({ event: 'clear' });
          break;
        case 'set-system':
          setSystemPrompt(action.prompt);
          addSystemMessage(action.prompt ? 'System prompt updated.' : 'System prompt cleared.');
          logger.log({ event: 'set_system_prompt', prompt: action.prompt });
          break;
        case 'set-model':
          setModel(action.model);
          addSystemMessage(`Model set to ${action.model}.`);
          logger.log({ event: 'set_model', model: action.model });
          checkToolSupport(config.baseUrl, action.model)
            .then((ok) => {
              if (!ok) {
                addSystemMessage(`Warning: ${action.model} does not advertise tool support. Tool calls may fail.`);
              }
            })
            .catch(() => {});
          break;
        case 'set-temperature':
          setTemperature(action.temperature);
          addSystemMessage(`Temperature set to ${action.temperature.toFixed(1)}.`);
          logger.log({ event: 'set_temperature', temperature: action.temperature });
          break;
        case 'retry': {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          if (lastUser && lastUser.role === 'user') {
            logger.log({ event: 'retry', content: lastUser.content });
            generate(lastUser.content);
          } else {
            addSystemMessage('No user message to retry.');
          }
          break;
        }
        case 'list-models': {
          const models = await testConnection();
          if (models.length === 0) {
            addSystemMessage('No models found or Ollama unreachable.');
          } else {
            const names = models.map((m) => m.name).join(', ');
            addSystemMessage(`Installed models: ${names}`);
          }
          logger.log({ event: 'list_models', models: models.map((m) => m.name) });
          break;
        }
        case 'not-implemented':
          addSystemMessage(`/${action.command} is not implemented yet.`);
          break;
        case 'error':
          addSystemMessage(action.message);
          break;
        case 'noop':
          if (action.message) addSystemMessage(action.message);
          break;
      }
      return;
    }

    if (generating) return;
    generate(value);
  }

  async function generate(userContent: string) {
    setGenerating(true);
    setPartial('');
    setReasoning('');
    setError(null);
    toolCallsRef.current = [];
    generatedTokensRef.current = 0;

    const userMsg: UserMessage = { role: 'user', content: userContent };
    let history: ConversationMessage[] = [...messages, userMsg];
    setMessages(history);
    logger.log({ event: 'user_message', content: userContent });

    const generationStart = Date.now();
    setStats((s) => ({ ...s, generationStart, generatedTokens: 0 }));

    let firstTokenTime: number | null = null;
    const toolDefs = getToolDefinitions();

    try {
      while (true) {
        const result = await streamCompletion(
          client,
          {
            model,
            messages: history,
            temperature,
            systemPrompt,
            tools: toolDefs,
          },
          {
            onContent(content) {
              if (!firstTokenTime) firstTokenTime = Date.now();
              setPartial(content);
              const tokens = estimateTokens(content + reasoning);
              generatedTokensRef.current = tokens;
              setStats((s) => ({ ...s, generatedTokens: tokens }));
            },
            onReasoning(r) {
              setReasoning(r);
              const tokens = estimateTokens(partial + r);
              generatedTokensRef.current = tokens;
              setStats((s) => ({ ...s, generatedTokens: tokens }));
            },
            onToolCallDelta(tc) {
              const idx = tc.index;
              toolCallsRef.current[idx] = { ...(toolCallsRef.current[idx] ?? {}), ...tc } as ToolCallInProgress;
            },
            onUsage(usage) {
              generatedTokensRef.current = usage.completionTokens;
              setStats((s) => ({ ...s, generatedTokens: usage.completionTokens }));
            },
          },
        );

        const assistantContent = result.content ?? partial;
        
        // Add assistant message to history
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: assistantContent,
        };
        
        // If there are tool calls, add them to the assistant message
        if (result.toolCalls.length > 0) {
          (assistantMsg as any).tool_calls = result.toolCalls.map((tc) => ({
            id: tc.id || `call_${Date.now()}_${tc.index}`,
            type: 'function' as const,
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '{}',
            },
          }));
        }
        
        history = [...history, assistantMsg];
        setMessages(history);
        
        logger.log({
          event: 'assistant_message',
          content: assistantContent,
          reasoning: result.reasoning,
          toolCalls: result.toolCalls,
          generatedTokens: generatedTokensRef.current,
        });

        // If no tool calls, we're done
        if (result.toolCalls.length === 0) {
          break;
        }

        // Process tool calls
        const newActivities: ToolActivity[] = [];
        
        for (const tc of result.toolCalls) {
          const callId = tc.id || `call_${Date.now()}_${tc.index}`;
          const toolName = tc.function?.name || '';
          let args: Record<string, unknown> = {};
          
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }

          // Validate
          const validation = validateToolCall({
            id: callId,
            type: 'function',
            function: { name: toolName, arguments: tc.function?.arguments || '{}' },
          });

          const activity: ToolActivity = {
            id: `activity_${callId}`,
            toolCallId: callId,
            toolName,
            arguments: args,
            status: validation.valid ? 'awaiting_approval' : 'failed',
            validationError: validation.error,
            preview: JSON.stringify(args, null, 2),
          };

          newActivities.push(activity);
          logger.log({
            event: 'tool_call',
            tool: toolName,
            args,
            valid: validation.valid,
            validationError: validation.error,
          });
        }

        // Add all activities to state
        setToolActivities((prev) => [...prev, ...newActivities]);

        // Process each activity
        for (const activity of newActivities) {
          if (activity.status === 'failed') {
            // Already failed validation
            setStats((s) => ({ ...s, toolFail: s.toolFail + 1 }));
            continue;
          }

          // Await approval
          setPendingApproval(activity.id);
          const approved = await new Promise<boolean>((resolve) => {
            approvalResolvers.current.set(activity.id, resolve);
          });

          if (approved) {
            const result = await executeToolActivity(activity);
            
            // Add tool result to history
            const toolMsg: ConversationMessage = {
              role: 'tool',
              tool_call_id: activity.toolCallId,
              content: result.error ? `Error: ${result.error}` : (result.output || ''),
            };
            history = [...history, toolMsg];
            setMessages(history);
          } else {
            // Denied
            const toolMsg: ConversationMessage = {
              role: 'tool',
              tool_call_id: activity.toolCallId,
              content: 'Tool call denied by user',
            };
            history = [...history, toolMsg];
            setMessages(history);
            logger.log({
              event: 'tool_denied',
              tool: activity.toolName,
              args: activity.arguments,
            });
          }
        }

        // Continue loop to get model's response after tool calls
        setPartial('');
        setReasoning('');
        setGenerating(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/404|not found/i.test(message)) {
        setError(`Model "${model}" not found. Run: ollama pull ${model} — or switch with /model <name>.`);
        logger.log({ event: 'model_not_found', model, error: message });
      } else if (/connection|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket|network|timeout/i.test(message)) {
        setConnected(false);
        setError(`Connection lost. Check that Ollama is running at ${config.baseUrl}, then press Enter to retry.`);
        logger.log({ event: 'connection_error', error: message });
      } else {
        setError(message);
        logger.log({ event: 'generation_error', error: message });
      }
    } finally {
      setGenerating(false);
      setPartial('');
      setReasoning('');
      setPendingApproval(null);
      setStats((s) => ({ ...s, generationStart: null }));
    }
  }

  return (
    <Box flexDirection="column" height={termRows} overflow="hidden">
      <TopBar model={model || '—'} temperature={temperature} systemPrompt={systemPrompt} />
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexGrow={toolActivities.length > 0 ? 1 : 1} flexDirection="column">
          <ChatPanel messages={messages} partial={partial} reasoning={reasoning} generating={generating} error={error} />
        </Box>
        {toolActivities.length > 0 && (
          <Box flexGrow={1} flexDirection="column">
            <ToolPanel activities={toolActivities} />
          </Box>
        )}
      </Box>
      <InputLine
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={generating || hasToolPrompt || connectionError}
        placeholder={
          connectionError
            ? 'Ollama unreachable — press Enter to retry'
            : pendingApproval
              ? 'Press [a] approve or [d] deny'
              : hasFailedTool
                ? 'Press [f] fix, [s] skip, or [r] retry'
                : generating
                  ? 'Generating…'
                  : 'Type a message, or / for commands'
        }
      />
      <StatsBar
        connected={connected}
        checking={checking}
        generating={generating}
        tokensPerSecond={tokensPerSecond}
        contextTokens={contextTokens}
        toolSuccess={stats.toolSuccess}
        toolFail={stats.toolFail}
      />
    </Box>
  );
}
