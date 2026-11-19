import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Divider,
  MessageList,
  PermissionRequest,
  PromptInput,
  Spinner,
  StatusLine,
  useTerminalSize,
  type Message,
  type MessageContent,
  type PermissionAction,
  type StatusLineSegment,
  type VirtualListHandle,
} from '@claude-code-kit/ui';
import { Box, Text, useInput } from '@claude-code-kit/ink-renderer';
import type { Config } from './config.js';
import {
  checkToolSupport,
  createClient,
  listInstalledModels,
  streamCompletion,
  getModelContextLength,
  type ToolCallInProgress,
} from './model/ollama.js';
import { parseCommand, getFilteredCommands, type CommandDef } from './commands/index.js';
import {
  estimateContextTokens,
  fillMissingToolResults,
  toOpenAIMessages,
  type ConversationMessage,
} from './model/session.js';
import { createLogger } from './logger.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from './tools/executor.js';
import type { ToolContext } from './tools/types.js';
import { XakuWelcome } from './ui/XakuWelcome.js';
import { XakuMenu } from './ui/XakuMenu.js';
import { XakuHeader } from './ui/XakuHeader.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { useBlink, useTypewriter } from './ui/hooks.js';
import { getGitBranch } from './ui/git.js';
import { colors } from './ui/theme.js';

export interface AppProps {
  config: Config;
}

interface PendingTool {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

function toKitMessages(messages: ConversationMessage[]): Message[] {
  return messages.map((m, i) => {
    if (m.role === 'user') {
      return { id: `m-${i}`, role: 'user' as const, content: m.content };
    }
    if (m.role === 'assistant') {
      const blocks: MessageContent[] = [];
      if (m.reasoning) blocks.push({ type: 'thinking', text: m.reasoning });
      if (m.content) blocks.push({ type: 'text', text: m.content });
      return { id: `m-${i}`, role: 'assistant' as const, content: blocks };
    }
    if (m.role === 'system') {
      return { id: `m-${i}`, role: 'system' as const, content: m.content };
    }
    if (m.role === 'tool') {
      return {
        id: `m-${i}`,
        role: 'system' as const,
        content: `⎿ tool result (${m.tool_call_id}): ${m.content}`,
      };
    }
    return { id: `m-${i}`, role: 'system' as const, content: '' };
  });
}

export default function App({ config }: AppProps) {
  const { rows, columns } = useTerminalSize();
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

  useEffect(() => {
    return () => {
      logger.close();
    };
  }, [logger]);

  const [menuActive, setMenuActive] = useState(true);
  const [model, setModel] = useState(config.model ?? '');
  const [temperature, setTemperature] = useState(config.temperature);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(config.systemPrompt);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partial, setPartial] = useState('');
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxContextTokens, setMaxContextTokens] = useState(128000);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [toolSuccess, setToolSuccess] = useState(0);
  const [toolFail, setToolFail] = useState(0);

  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [pendingToolResolve, setPendingToolResolve] = useState<((approved: boolean) => void) | null>(null);

  const [inputValue, setInputValue] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [showThinking, setShowThinking] = useState(false);

  const toolCallsRef = useRef<ToolCallInProgress[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generationEpochRef = useRef(0);
  const historyRef = useRef<VirtualListHandle>(null);

  const contextTokens = useMemo(
    () => estimateContextTokens(messages, systemPrompt, partial),
    [messages, systemPrompt, partial],
  );

  useEffect(() => {
    testConnection();
  }, [client]);

  useEffect(() => {
    getGitBranch(config.workspace).then(setGitBranch);
  }, [config.workspace]);

  useEffect(() => {
    if (model) {
      getModelContextLength(config.baseUrl, model).then(setMaxContextTokens);
    }
  }, [model, config.baseUrl]);

  async function testConnection() {
    try {
      const models = await listInstalledModels(config.baseUrl);
      setConnected(true);
      setError(null);
      if (models.length === 0) {
        addSystemMessage('No models installed. Run: ollama pull qwen3:4b');
        return;
      }
      const installedNames = models.map((m) => m.name);
      let activeModel = model;
      if (!activeModel) {
        activeModel = installedNames[0];
        setModel(activeModel);
        logger.log({ event: 'set_model', model: activeModel, reason: 'auto' });
      } else if (!installedNames.includes(activeModel)) {
        const fallback = installedNames[0];
        addSystemMessage(`Model "${activeModel}" is not installed. Switched to ${fallback}.`);
        activeModel = fallback;
        setModel(fallback);
        logger.log({ event: 'set_model', model: fallback, reason: 'fallback' });
      }
      try {
        const supportsTools = await checkToolSupport(config.baseUrl, activeModel);
        if (!supportsTools) {
          addSystemMessage(`Warning: ${activeModel} does not advertise tool support.`);
        }
      } catch {
        // best-effort
      }
    } catch {
      setConnected(false);
      setError(`Cannot reach Ollama at ${config.baseUrl}. Start Ollama, then press Enter to retry.`);
    }
  }

  function addSystemMessage(content: string) {
    setMessages((prev) => [...prev, { role: 'system', content }]);
  }

  function cleanupGeneration(): number {
    generationEpochRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (pendingToolResolve) {
      pendingToolResolve(false);
      setPendingToolResolve(null);
      setPendingTool(null);
    }
    setGenerating(false);
    setPartial('');
    return 0;
  }

  function cancelGeneration() {
    cleanupGeneration();
    addSystemMessage('Generation cancelled.');
    logger.log({ event: 'generation_cancelled' });
  }

  function buildPreview(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'write_file':
        return `write ${args.path ?? ''}`;
      case 'run_shell':
        return `$ ${args.command ?? ''}`;
      case 'query_db':
        return `db: ${args.path ?? ''}\n${args.query ?? ''}`;
      case 'read_file':
        return `read ${args.path ?? ''}`;
      case 'list_dir':
        return `list ${args.path ?? '.'}`;
      default:
        return JSON.stringify(args, null, 2);
    }
  }

  async function waitForApproval(tool: PendingTool): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      setPendingTool(tool);
      setPendingToolResolve(() => resolve);
    });
  }

  function handlePermissionDecision(action: PermissionAction) {
    const resolve = pendingToolResolve;
    if (resolve) {
      resolve(action === 'allow' || action === 'always_allow');
    }
    setPendingTool(null);
    setPendingToolResolve(null);
  }

  async function resumeGeneration(updatedHistory: ConversationMessage[]) {
    const epoch = ++generationEpochRef.current;
    const repairedHistory = fillMissingToolResults(updatedHistory);
    setMessages(repairedHistory);
    setGenerating(true);
    setPartial('');
    setPendingTool(null);
    toolCallsRef.current = [];

    let history = repairedHistory;

    try {
      while (true) {
        if (generationEpochRef.current !== epoch) return;
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const toolDefs = getToolDefinitions();
        const result = await streamCompletion(
          client,
          {
            model,
            messages: toOpenAIMessages(history),
            temperature,
            systemPrompt,
            tools: toolDefs,
            signal: abortController.signal,
          },
          {
            onContent(content) {
              setPartial(content);
            },
            onToolCallDelta(tc) {
              const idx = tc.index;
              toolCallsRef.current[idx] = { ...(toolCallsRef.current[idx] ?? {}), ...tc } as ToolCallInProgress;
            },
          },
        );

        abortControllerRef.current = null;
        if (generationEpochRef.current !== epoch) return;

        const assistantContent = result.content ?? partial;
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: assistantContent,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        };

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
        setPartial('');

        logger.log({
          event: 'assistant_message',
          content: assistantContent,
          reasoning: result.reasoning,
          toolCalls: result.toolCalls,
        });

        if (result.toolCalls.length === 0) {
          break;
        }

        for (const tc of result.toolCalls) {
          const callId = tc.id || `call_${Date.now()}_${tc.index}`;
          const toolName = tc.function?.name || '';
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch {
            args = {};
          }

          const validation = validateToolCall({
            id: callId,
            type: 'function',
            function: { name: toolName, arguments: tc.function?.arguments || '{}' },
          });

          if (!validation.valid) {
            addSystemMessage(`Tool error (${toolName}): ${validation.error}`);
            history = [...history, {
              role: 'tool',
              tool_call_id: callId,
              content: `Error: ${validation.error}`,
            }];
            setMessages(history);
            continue;
          }

          const approved = await waitForApproval({
            callId,
            toolName,
            args,
          });

          if (generationEpochRef.current !== epoch) return;

          if (!approved) {
            addSystemMessage(`Tool call denied: ${toolName}`);
            history = [...history, {
              role: 'tool',
              tool_call_id: callId,
              content: 'Tool call denied by user.',
            }];
            setMessages(history);
            continue;
          }

          const toolCtx: ToolContext = {
            workspace: config.workspace,
            maxResultBytes: config.maxResultBytes,
            shellTimeoutMs: config.shellTimeoutMs,
          };

          const toolResult = await executeToolCall(
            {
              id: callId,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
            toolCtx,
          );

          if (toolResult.error) {
            setToolFail((prev) => prev + 1);
            addSystemMessage(`Tool error (${toolName}): ${toolResult.error}`);
            history = [...history, {
              role: 'tool',
              tool_call_id: callId,
              content: `Error: ${toolResult.error}`,
            }];
          } else {
            setToolSuccess((prev) => prev + 1);
            history = [...history, {
              role: 'tool',
              tool_call_id: callId,
              content: toolResult.output || '',
            }];
          }
          setMessages(history);

          logger.log({
            event: 'tool_call',
            toolCallId: callId,
            tool: toolName,
            args,
            result: toolResult.error ? { error: toolResult.error } : { output: toolResult.output },
          });
        }

        setPartial('');
        setGenerating(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
        return;
      }
      if (/404|not found/i.test(message)) {
        setError(`Model "${model}" not found. Run: ollama pull ${model}`);
        logger.log({ event: 'model_not_found', model, error: message });
      } else if (/connection|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
        setConnected(false);
        setError(`Connection lost. Check that Ollama is running at ${config.baseUrl}.`);
        logger.log({ event: 'connection_error', error: message });
      } else {
        setError(message);
        logger.log({ event: 'generation_error', error: message });
      }
    } finally {
      if (generationEpochRef.current === epoch) {
        setGenerating(false);
        setPartial('');
        setPendingTool(null);
        abortControllerRef.current = null;
      }
    }
  }

  async function generate(userInput: string) {
    const userMsg: ConversationMessage = { role: 'user', content: userInput };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    logger.log({ event: 'user_message', content: userInput });
    await resumeGeneration(newHistory);
  }

  async function handleSubmit(raw: string) {
    const value = raw.trim();
    if (!value) return;

    setInputHistory((prev) => [value, ...prev].slice(0, 50));

    if (value.startsWith('/')) {
      logger.log({ event: 'command', command: value });
      const action = parseCommand(value);
      switch (action.type) {
        case 'clear':
          setMessages([]);
          setPartial('');
          setError(null);
          setToolSuccess(0);
          setToolFail(0);
          break;
        case 'set-system':
          setSystemPrompt(action.prompt);
          addSystemMessage(action.prompt ? 'System prompt updated.' : 'System prompt cleared.');
          break;
        case 'set-model':
          setModel(action.model);
          addSystemMessage(`Model set to ${action.model}.`);
          break;
        case 'set-temperature':
          setTemperature(action.temperature);
          addSystemMessage(`Temperature set to ${action.temperature.toFixed(1)}.`);
          break;
        case 'retry': {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          if (lastUser && lastUser.role === 'user') {
            cleanupGeneration();
            await generate(lastUser.content);
          } else {
            addSystemMessage('No user message to retry.');
          }
          break;
        }
        case 'list-models': {
          try {
            const models = await listInstalledModels(config.baseUrl);
            addSystemMessage(`Installed models: ${models.map((m) => m.name).join(', ')}`);
          } catch {
            addSystemMessage('Could not list models.');
          }
          break;
        }
        case 'cancel':
          if (generating) {
            cancelGeneration();
          } else {
            addSystemMessage('Nothing to cancel.');
          }
          break;
        case 'stats': {
          const lines = [
            `Model: ${model || '—'}`,
            `Temperature: ${temperature}`,
            `Context tokens: ~${contextTokens}`,
            `Messages: ${messages.length}`,
          ];
          addSystemMessage(lines.join('\n'));
          break;
        }
        default:
          addSystemMessage(`Unknown command: ${action.type}`);
      }
      return;
    }

    if (error) {
      setError(null);
      await testConnection();
      return;
    }

    if (generating) return;

    await generate(value);
  }

  function handleModelSelect(newModel: string) {
    setMessages([]);
    setPartial('');
    setError(null);
    setToolSuccess(0);
    setToolFail(0);
    setModel(newModel);
    addSystemMessage(`Model set to ${newModel}. Ready to chat.`);
  }

  // --- Command palette ---
  const slashQuery = useMemo(() => {
    if (paletteDismissed) return null;
    if (!inputValue.startsWith('/')) return null;
    if (inputValue.includes(' ')) return null;
    return inputValue.slice(1);
  }, [inputValue, paletteDismissed]);

  const suggestions = useMemo(
    () => (slashQuery !== null ? getFilteredCommands(slashQuery) : []),
    [slashQuery],
  );

  const paletteVisible = slashQuery !== null && suggestions.length > 0;
  const paletteRows = paletteVisible ? Math.min(6, suggestions.length) + 2 : 0;

  useEffect(() => {
    setPaletteIndex(0);
  }, [suggestions.length, slashQuery]);

  useEffect(() => {
    if (!inputValue.startsWith('/') || inputValue.includes(' ')) {
      setPaletteDismissed(false);
    }
  }, [inputValue]);

  function handlePaletteMove(delta: number) {
    setPaletteIndex((i) => {
      const n = suggestions.length;
      if (n === 0) return 0;
      return ((i + delta) % n + n) % n;
    });
  }

  function handlePaletteSelect(cmd: CommandDef) {
    setInputValue(`/${cmd.name} `);
    setPaletteIndex(0);
  }

  function handlePaletteDismiss() {
    setPaletteDismissed(true);
  }

  // --- Global key handlers ---
  useInput((input, key, event) => {
    if (key.ctrl && input === 't') {
      event.stopImmediatePropagation();
      setShowThinking((v) => !v);
    }
  });

  useInput(
    (input, key, event) => {
      if (key.ctrl && input === 'c') {
        if (generating) {
          event.stopImmediatePropagation();
          cancelGeneration();
        } else if (pendingTool) {
          event.stopImmediatePropagation();
          handlePermissionDecision('deny');
        }
      }
    },
    { captureCtrlC: generating || !!pendingTool },
  );

  // --- Typewriter animation ---
  const animatedPartial = useTypewriter(generating ? partial : '');
  const cursorOn = useBlink(530, generating);

  // --- Kit message construction ---
  const baseKitMessages = toKitMessages(messages);
  const kitMessages: Message[] = generating
    ? [
        ...baseKitMessages,
        {
          id: '__xaku-streaming',
          role: 'assistant' as const,
          content: animatedPartial
            ? [{ type: 'text', text: animatedPartial }]
            : [],
        },
      ]
    : baseKitMessages;

  const hasThinking = messages.some((m) => m.role === 'assistant' && m.reasoning);

  function renderMessage(message: Message) {
    const blocks: MessageContent[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : message.content;

    const textOf = (bs: MessageContent[]) =>
      bs
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('');

    if (message.role === 'user') {
      const text = textOf(blocks);
      const lines = text.split('\n');
      return (
        <Box flexDirection="column">
          <Box>
            <Text color={colors.highlight}>❯</Text>
            <Text color={colors.highlight} bold>
              {' '}
              You
            </Text>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            {lines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        </Box>
      );
    }

    if (message.role === 'assistant') {
      const isStreaming = message.id === '__xaku-streaming';
      const hasText = blocks.some(
        (b) => b.type === 'text' && (b as Extract<MessageContent, { type: 'text' }>).text.length > 0,
      );

      return (
        <Box flexDirection="column">
          <Box>
            <Text color={colors.accent}>●</Text>
            <Text color={colors.accent} bold>
              {' '}
              {model || 'model'}
            </Text>
            {isStreaming && !hasText && (
              <Text dimColor> is thinking…</Text>
            )}
          </Box>

          {isStreaming && !hasText && (
            <Box marginLeft={2}>
              <Spinner color={colors.accent} />
            </Box>
          )}

          {blocks.map((block, bi) => {
            if (block.type === 'thinking') {
              const thinkingLines = block.text.split('\n');
              return (
                <Box key={bi} flexDirection="column" marginLeft={2}>
                  <Text color={colors.accent} dimColor>
                    ✻ Thinking… {showThinking ? '' : '(Ctrl+T to expand)'}
                  </Text>
                  {showThinking &&
                    thinkingLines.map((line, i) => (
                      <Box key={i} marginLeft={2}>
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}
                </Box>
              );
            }
            if (block.type === 'text') {
              const lines = block.text.split('\n');
              const lastIdx = lines.length - 1;
              return (
                <Box key={bi} flexDirection="column" marginLeft={2}>
                  {lines.map((line, i) => (
                    <Text key={i}>
                      {line}
                      {isStreaming && i === lastIdx && cursorOn && (
                        <Text color={colors.accent}>▌</Text>
                      )}
                    </Text>
                  ))}
                </Box>
              );
            }
            return null;
          })}
        </Box>
      );
    }

    // system
    const text = textOf(blocks);
    const lines = text.split('\n');
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    );
  }

  const statusSegments: StatusLineSegment[] = [
    { content: connected ? 'connected' : 'disconnected', color: connected ? colors.accentBright : colors.accent },
    { content: `temp ${temperature.toFixed(1)}`, color: 'dim' },
    { content: 'Ctrl+T thinking', color: 'dim' },
    { content: 'Ctrl+C cancel', color: 'dim' },
  ];

  const viewportHeight = Math.max(
    3,
    rows - 7 - paletteRows - (pendingTool ? 8 : 0),
  );

  const welcome = (
    <XakuWelcome
      model={model}
      connected={connected}
      temperature={temperature}
    />
  );

  if (menuActive) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <XakuMenu
          baseUrl={config.baseUrl}
          currentModel={model}
          onModelSelect={handleModelSelect}
          onDismiss={() => setMenuActive(false)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <XakuHeader
        model={model}
        contextTokens={contextTokens}
        maxContextTokens={maxContextTokens}
        toolSuccess={toolSuccess}
        toolFail={toolFail}
        gitBranch={gitBranch}
        isGenerating={generating}
        showThinking={showThinking}
        hasThinking={hasThinking}
      />
      {messages.length === 0 && !generating ? (
        <Box marginBottom={1}>{welcome}</Box>
      ) : (
        <MessageList
          ref={historyRef}
          messages={kitMessages}
          viewportHeight={viewportHeight}
          renderMessage={renderMessage}
        />
      )}
      <Divider />
      <CommandPalette
        isOpen={paletteVisible}
        suggestions={suggestions}
        selectedIndex={paletteIndex}
        onMove={handlePaletteMove}
        onSelect={handlePaletteSelect}
        onDismiss={handlePaletteDismiss}
        columns={columns}
      />
      {pendingTool ? (
        <PermissionRequest
          toolName={pendingTool.toolName}
          description={`Run ${pendingTool.toolName}?`}
          details={buildPreview(pendingTool.toolName, pendingTool.args)}
          onDecision={handlePermissionDecision}
        />
      ) : (
        <PromptInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          prefix="❯"
          prefixColor={colors.accent}
          placeholder="Ask anything... (/ for commands)"
          disabled={generating}
          history={inputHistory}
        />
      )}
      <Divider />
      <StatusLine segments={statusSegments} />
    </Box>
  );
}
