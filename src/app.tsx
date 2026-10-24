import { Box, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Config, AutoApproveMode } from './config.js';
import { AUTO_APPROVE_MODES } from './config.js';
import {
  checkToolSupport,
  createClient,
  listInstalledModels,
  streamCompletion,
  type ToolCallInProgress,
} from './model/ollama.js';
import { parseCommand } from './commands/index.js';
import { estimateContextTokens, estimateTokens, fillMissingToolResults, type ConversationMessage, type UserMessage } from './model/session.js';
import { createLogger } from './logger.js';
import { exportSession } from './commands/report.js';
import { saveTestCase, loadTestCase } from './commands/cases.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { InputLine } from './ui/InputLine.js';
import { StatsBar } from './ui/StatsBar.js';
import { TopBar } from './ui/TopBar.js';
import { ToolPanel } from './ui/ToolPanel.js';
import type { ToolActivity } from './ui/ToolActivity.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from './tools/executor.js';
import { tools } from './tools/registry.js';
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

  useEffect(() => {
    return () => {
      logger.close();
    };
  }, [logger]);

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
  const [autoApprove, setAutoApproveState] = useState<AutoApproveMode>(config.autoApprove);
  const autoApproveRef = useRef<AutoApproveMode>(config.autoApprove);

  function setAutoApprove(mode: AutoApproveMode) {
    autoApproveRef.current = mode;
    setAutoApproveState(mode);
  }

  function shouldAutoApprove(toolName: string): boolean {
    const mode = autoApproveRef.current;
    if (mode === 'all') return true;
    if (mode === 'read-only') return tools[toolName]?.isReadOnly === true;
    return false;
  }

  const toolCallsRef = useRef<ToolCallInProgress[]>([]);
  const generatedTokensRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Incremented on every new generation/cleanup so stale resumeGeneration loops
  // can detect they were superseded (by cancel, retry, or fix/skip/retry) and stop
  // before mutating shared state.
  const generationEpochRef = useRef(0);

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

  useInput(
    (char, key) => {
      if (key.escape && generating) {
        cancelGeneration();
        return;
      }

      if (char === 't' && generating) {
        cycleAutoApprove();
        return;
      }

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
    { isActive: generating || hasToolPrompt || connectionError },
  );

  function cleanupGeneration(): number {
    generationEpochRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const runningActivities = [...toolControllersRef.current.keys()];
    for (const controller of toolControllersRef.current.values()) {
      controller.abort();
    }
    toolControllersRef.current.clear();
    if (runningActivities.length > 0) {
      setToolActivities((prev) =>
        prev.map((a) =>
          runningActivities.includes(a.id) ? { ...a, status: 'cancelled' } : a,
        ),
      );
    }
    // Wake any loop suspended on the approval promise; its epoch check makes it
    // exit without touching the new generation's state.
    for (const resolve of approvalResolvers.current.values()) {
      resolve(false);
    }
    approvalResolvers.current.clear();
    setGenerating(false);
    setPartial('');
    setReasoning('');
    setPendingApproval(null);
    setStats((s) => ({ ...s, generationStart: null }));
    return runningActivities.length;
  }

  function cancelGeneration() {
    const cancelledTools = cleanupGeneration();
    addSystemMessage('Generation cancelled.');
    logger.log({ event: 'generation_cancelled', cancelledTools });
  }

  function addSystemMessage(content: string) {
    setMessages((prev) => [...prev, { role: 'system', content }]);
  }

  function buildPreview(toolName: string, args: Record<string, unknown>): string {
    switch (toolName) {
      case 'write_file': {
        const filePath = args.path ?? '';
        const content = String(args.content ?? '');
        return `path: ${filePath}\ncontent:\n${content.length > 300 ? content.slice(0, 300) + '...' : content}`;
      }
      case 'run_shell':
        return `$ ${args.command ?? ''}`;
      case 'query_db':
        return `db: ${args.path ?? ''}\n${args.query ?? ''}`;
      default:
        return JSON.stringify(args, null, 2);
    }
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

  function applyAutoApprove(mode: AutoApproveMode, via: 'command' | 'hotkey') {
    setAutoApprove(mode);
    logger.log({ event: 'set_auto_approve', mode, via });
    // If the currently pending tool is covered by the new mode, approve it now.
    if (pendingApproval) {
      const activity = toolActivities.find((a) => a.id === pendingApproval);
      if (activity && (mode === 'all' || (mode === 'read-only' && tools[activity.toolName]?.isReadOnly))) {
        approveToolCall(pendingApproval);
      }
    }
  }

  function cycleAutoApprove() {
    const idx = AUTO_APPROVE_MODES.indexOf(autoApproveRef.current);
    const next = AUTO_APPROVE_MODES[(idx + 1) % AUTO_APPROVE_MODES.length];
    addSystemMessage(`Auto-approve: ${next}.`);
    applyAutoApprove(next, 'hotkey');
  }

  function fixToolCall(activityId: string) {
    const activity = toolActivities.find((a) => a.id === activityId);
    if (!activity) return;
    cleanupGeneration();
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'skipped' } : a)),
    );
    logger.log({ event: 'tool_choice', tool: activity.toolName, args: activity.arguments, choice: 'fix' });
    const errorMsg = activity.error ?? 'Tool call failed';
    const toolMsg: ConversationMessage = {
      role: 'tool',
      tool_call_id: activity.toolCallId,
      content: `Error: ${errorMsg}. Please try a different approach.`,
    };
    resumeGeneration([...messages, toolMsg]);
  }

  function skipToolCall(activityId: string) {
    const activity = toolActivities.find((a) => a.id === activityId);
    if (!activity) return;
    cleanupGeneration();
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'skipped' } : a)),
    );
    logger.log({ event: 'tool_choice', tool: activity.toolName, args: activity.arguments, choice: 'skip' });
    const toolMsg: ConversationMessage = {
      role: 'tool',
      tool_call_id: activity.toolCallId,
      content: 'Tool call skipped by user.',
    };
    resumeGeneration([...messages, toolMsg]);
  }

  async function retryToolCall(activityId: string) {
    const activity = toolActivities.find((a) => a.id === activityId);
    if (!activity) return;
    cleanupGeneration();

    const result = await executeToolActivity(activity);
    const toolMsg: ConversationMessage = {
      role: 'tool',
      tool_call_id: activity.toolCallId,
      content: result.error ? `Error: ${result.error}` : (result.output || ''),
    };
    logger.log({ event: 'tool_choice', tool: activity.toolName, args: activity.arguments, choice: 'retry' });
    resumeGeneration([...messages, toolMsg]);
  }

  async function resumeGeneration(updatedHistory: ConversationMessage[]) {
    const epoch = ++generationEpochRef.current;
    const repairedHistory = fillMissingToolResults(updatedHistory);
    setMessages(repairedHistory);
    setGenerating(true);
    setPartial('');
    setReasoning('');
    setPendingApproval(null);
    setToolActivities([]);
    toolCallsRef.current = [];
    generatedTokensRef.current = 0;

    const generationStart = Date.now();
    setStats((s) => ({ ...s, generationStart, generatedTokens: 0 }));

    let firstTokenTime: number | null = null;
    const toolDefs = getToolDefinitions();
    let history = repairedHistory;

    try {
      while (true) {
        if (generationEpochRef.current !== epoch) return;
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

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

        abortControllerRef.current = null;
        if (generationEpochRef.current !== epoch) return;

        const assistantContent = result.content ?? partial;
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: assistantContent,
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

        logger.log({
          event: 'assistant_message',
          content: assistantContent,
          reasoning: result.reasoning,
          toolCalls: result.toolCalls,
          generatedTokens: generatedTokensRef.current,
        });

        if (result.toolCalls.length === 0) {
          break;
        }

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
            preview: buildPreview(toolName, args),
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

        setToolActivities((prev) => [...prev, ...newActivities]);

        for (const activity of newActivities) {
          if (activity.status === 'failed') {
            setStats((s) => ({ ...s, toolFail: s.toolFail + 1 }));
            continue;
          }

          let approved: boolean;
          if (shouldAutoApprove(activity.toolName)) {
            approved = true;
            setToolActivities((prev) =>
              prev.map((a) =>
                a.id === activity.id ? { ...a, status: 'approved', autoApproved: true } : a,
              ),
            );
            logger.log({
              event: 'tool_auto_approved',
              tool: activity.toolName,
              args: activity.arguments,
              mode: autoApproveRef.current,
            });
          } else {
            setPendingApproval(activity.id);
            approved = await new Promise<boolean>((resolve) => {
              approvalResolvers.current.set(activity.id, resolve);
            });
            if (generationEpochRef.current !== epoch) return;
          }

          if (approved) {
            const result = await executeToolActivity(activity);
            const toolMsg: ConversationMessage = {
              role: 'tool',
              tool_call_id: activity.toolCallId,
              content: result.error ? `Error: ${result.error}` : (result.output || ''),
            };
            history = [...history, toolMsg];
            setMessages(history);
          } else {
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

        setPartial('');
        setReasoning('');
        setGenerating(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
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
      if (generationEpochRef.current === epoch) {
        setGenerating(false);
        setPartial('');
        setReasoning('');
        setPendingApproval(null);
        setStats((s) => ({ ...s, generationStart: null }));
        abortControllerRef.current = null;
      }
    }
  }

  async function executeToolActivity(activity: ToolActivity) {
    const startTime = Date.now();
    
    // Show as running
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activity.id ? { ...a, status: 'running', startTime } : a)),
    );

    const controller = new AbortController();
    toolControllersRef.current.set(activity.id, controller);

    const toolCtx: ToolContext = {
      workspace: config.workspace,
      maxResultBytes: config.maxResultBytes,
      shellTimeoutMs: config.shellTimeoutMs,
      abortSignal: controller.signal,
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

    toolControllersRef.current.delete(activity.id);

    const duration = (Date.now() - startTime) / 1000;

    if (result.cancelled) {
      setToolActivities((prev) =>
        prev.map((a) =>
          a.id === activity.id
            ? { ...a, status: 'cancelled', error: result.error, errorLabel: result.label, duration }
            : a,
        ),
      );
      logger.log({
        event: 'tool_cancelled',
        tool: activity.toolName,
        args: activity.arguments,
        duration,
      });
      return result;
    }

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
            cleanupGeneration();
            logger.log({ event: 'retry', content: lastUser.content });
            generate(lastUser.content);
          } else {
            addSystemMessage('No user message to retry.');
          }
          break;
        }
        case 'set-autoapprove':
          applyAutoApprove(action.mode, 'command');
          addSystemMessage(
            action.mode === 'none'
              ? 'Auto-approve disabled: every tool call asks for approval.'
              : `Auto-approve enabled: ${action.mode}.`,
          );
          break;
        case 'show-autoapprove':
          addSystemMessage(`Auto-approve is "${autoApprove}". Usage: /autoapprove <none|read-only|all>`);
          break;
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
        case 'cancel':
          if (generating) {
            cancelGeneration();
          } else {
            addSystemMessage('Nothing to cancel.');
          }
          break;
        case 'stats': {
          const lines = [
            `Session statistics:`,
            `  Messages: ${messages.length}`,
            `  Generated tokens: ${stats.generatedTokens}`,
            `  Context tokens: ~${contextTokens}`,
            `  Tool successes: ${stats.toolSuccess}`,
            `  Tool failures: ${stats.toolFail}`,
            `  Model: ${model || '—'}`,
            `  Temperature: ${temperature}`,
            `  Session log: ${logger.path}`,
          ];
          addSystemMessage(lines.join('\n'));
          logger.log({ event: 'stats_viewed', stats: { messages: messages.length, generatedTokens: stats.generatedTokens, contextTokens, toolSuccess: stats.toolSuccess, toolFail: stats.toolFail } });
          break;
        }
        case 'export': {
          try {
            const report = await exportSession(config, messages, model, temperature, systemPrompt, stats);
            addSystemMessage(`Report exported:\n  Markdown: ${report.mdPath}\n  JSON: ${report.jsonPath}`);
            logger.log({ event: 'export', mdPath: report.mdPath, jsonPath: report.jsonPath });
          } catch (err) {
            addSystemMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case 'save': {
          try {
            const lastUser = [...messages].reverse().find((m) => m.role === 'user');
            const promptToSave = lastUser && lastUser.role === 'user' ? lastUser.content : '';
            await saveTestCase(config, action.name, promptToSave, systemPrompt);
            addSystemMessage(`Test case "${action.name}" saved.`);
            logger.log({ event: 'save', name: action.name });
          } catch (err) {
            addSystemMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case 'load': {
          try {
            const testCase = await loadTestCase(config, action.name);
            if (testCase.systemPrompt) {
              setSystemPrompt(testCase.systemPrompt);
            }
            setInput(testCase.prompt);
            addSystemMessage(`Test case "${action.name}" loaded.`);
            logger.log({ event: 'load', name: action.name });
          } catch (err) {
            addSystemMessage(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
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
    setToolActivities([]);
    toolCallsRef.current = [];
    generatedTokensRef.current = 0;

    const userMsg: UserMessage = { role: 'user', content: userContent };
    const history: ConversationMessage[] = [...fillMissingToolResults(messages), userMsg];
    setMessages(history);
    logger.log({ event: 'user_message', content: userContent });

    const generationStart = Date.now();
    setStats((s) => ({ ...s, generationStart, generatedTokens: 0 }));

    await resumeGeneration(history);
  }

  return (
    <Box flexDirection="column" height={termRows} overflow="hidden">
      <TopBar
        model={model || '—'}
        temperature={temperature}
        systemPrompt={systemPrompt}
        autoApprove={autoApprove}
      />
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
              ? 'Press [a] approve, [d] deny, or [t] cycle auto-approve'
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
