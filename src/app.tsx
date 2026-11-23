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
import type { Config, AutoApproveMode } from './config.js';
import {
  checkToolSupport,
  createClient,
  listInstalledModels,
  streamCompletion,
  getModelContextLength,
  type ToolCallInProgress,
} from './model/ollama.js';
import { parseCommand, getFilteredCommands, type CommandDef, type CommandAction } from './commands/index.js';
import {
  estimateContextTokens,
  fillMissingToolResults,
  toOpenAIMessages,
  type ConversationMessage,
} from './model/session.js';
import { createLogger } from './logger.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from './tools/executor.js';
import { tools } from './tools/registry.js';
import { probeExistingFile } from './tools/utils.js';
import { computeDiffLines } from './ui/diff.js';
import {
  shouldAutoApprove,
  patchActivity,
  isTerminal,
  type ToolActivity,
} from './tools/activity.js';
import { resolveWorkspace, abbreviateHome, relativeToWorkspace } from './tools/workspace.js';
import { saveTestCase, loadTestCase } from './commands/cases.js';
import { computeStats, exportReport } from './commands/report.js';
import { XakuWelcome } from './ui/XakuWelcome.js';
import { XakuMenu } from './ui/XakuMenu.js';
import { XakuHeader } from './ui/XakuHeader.js';
import { ToolPanel } from './ui/ToolPanel.js';
import { CommandPalette, windowStart } from './ui/CommandPalette.js';
import { useBlink, useTypewriter } from './ui/hooks.js';
import { copyToClipboard } from './ui/clipboard.js';
import { getGitBranch } from './ui/git.js';
import { colors } from './ui/theme.js';

export interface AppProps {
  config: Config;
}

interface PendingTool {
  callId: string;
  activityId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** What the user chose after a tool failed. */
type FailureChoice = 'fix' | 'skip' | 'retry';

/** Hotkey letter → failure choice. */
const FAILURE_KEY_TO_CHOICE: Record<string, FailureChoice> = {
  f: 'fix',
  s: 'skip',
  r: 'retry',
};

/**
 * Tool result recorded for a failure choice. `skip` tells the model it was skipped;
 * `fix` and `retry` both start from the error text, and `retry` overwrites it with
 * the real outcome once the call re-runs.
 */
function resultFor(choice: FailureChoice, errorText: string): string {
  return choice === 'skip' ? 'Tool call skipped by user.' : `Error: ${errorText}`;
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

  // Workspace is App state, not derived from `config`, so `/cd` can change it
  // without recreating the logger (which would open a second session log file).
  const [workspace, setWorkspace] = useState(config.workspace);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  // One logger per app lifetime. Keyed on nothing on purpose.
  const logger = useMemo(
    () =>
      createLogger(config, {
        model: config.model,
        temperature: config.temperature,
        systemPrompt: config.systemPrompt,
        workspace: config.workspace,
        baseUrl: config.baseUrl,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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
  const [autoApprove, setAutoApprove] = useState<AutoApproveMode>(config.autoApprove);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [partial, setPartial] = useState('');
  const [generating, setGenerating] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxContextTokens, setMaxContextTokens] = useState(128000);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [compact, setCompact] = useState(false);

  // Session metrics for /stats and /export.
  const startedAtRef = useRef(Date.now());
  const [promptTokens, setPromptTokens] = useState(0);
  const [completionTokens, setCompletionTokens] = useState(0);
  const [generationMs, setGenerationMs] = useState(0);

  const [pendingTool, setPendingTool] = useState<PendingTool | null>(null);
  const [pendingToolResolve, setPendingToolResolve] = useState<((approved: boolean) => void) | null>(null);
  const [pendingFailure, setPendingFailure] = useState<{ activityId: string; toolName: string } | null>(null);
  const [failureResolve, setFailureResolve] = useState<((choice: FailureChoice | null) => void) | null>(null);

  const [inputValue, setInputValue] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const [copiedAt, setCopiedAt] = useState(0);

  const toolCallsRef = useRef<ToolCallInProgress[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolControllersRef = useRef<Map<string, AbortController>>(new Map());
  const generationEpochRef = useRef(0);
  const historyRef = useRef<VirtualListHandle>(null);
  const activitiesRef = useRef<ToolActivity[]>([]);
  activitiesRef.current = activities;

  const contextTokens = useMemo(
    () => estimateContextTokens(messages, systemPrompt, partial),
    [messages, systemPrompt, partial],
  );

  useEffect(() => {
    testConnection();
  }, [client]);

  useEffect(() => {
    getGitBranch(workspace).then(setGitBranch);
  }, [workspace]);

  useEffect(() => {
    if (model) {
      getModelContextLength(config.baseUrl, model).then(setMaxContextTokens);
    }
  }, [model, config.baseUrl]);

  /** The tool context is rebuilt per call so it always uses the current workspace. */
  function buildToolContext(activityId?: string): import('./tools/types.js').ToolContext {
    const controller = new AbortController();
    if (activityId) toolControllersRef.current.set(activityId, controller);
    return {
      workspace: workspaceRef.current,
      maxResultBytes: config.maxResultBytes,
      shellTimeoutMs: config.shellTimeoutMs,
      abortSignal: controller.signal,
    };
  }

  function releaseToolController(activityId: string) {
    toolControllersRef.current.delete(activityId);
  }

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
      addSystemMessage(`Workspace: ${abbreviateHome(workspaceRef.current)} · Model: ${activeModel}`);
    } catch {
      setConnected(false);
      setError(`Cannot reach Ollama at ${config.baseUrl}. Start Ollama, then press Enter to retry.`);
    }
  }

  function addSystemMessage(content: string) {
    setMessages((prev) => [...prev, { role: 'system', content }]);
  }

  function patch(id: string, patch_: Partial<ToolActivity>) {
    setActivities((prev) => patchActivity(prev, id, patch_));
  }

  function cleanupGeneration(): void {
    generationEpochRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    for (const [id, controller] of toolControllersRef.current) {
      controller.abort();
      const existing = activitiesRef.current.find((a) => a.id === id);
      if (existing && !isTerminal(existing.status)) {
        patch(id, {
          status: 'cancelled',
          durationMs: existing.startedAt ? Date.now() - existing.startedAt : undefined,
        });
      }
    }
    toolControllersRef.current.clear();
    if (pendingToolResolve) {
      pendingToolResolve(false);
      setPendingToolResolve(null);
      setPendingTool(null);
    }
    if (failureResolve) {
      failureResolve(null);
      setFailureResolve(null);
      setPendingFailure(null);
    }
    setGenerating(false);
    setPartial('');
  }

  function cancelGeneration() {
    cleanupGeneration();
    addSystemMessage('Generation cancelled.');
    logger.log({ event: 'generation_cancelled' });
  }

  /** Full preview shown before approval, with workspace-relative paths. */
  function buildPreview(toolName: string, args: Record<string, unknown>): string {
    const ws = workspaceRef.current;
    const showPath = (p: unknown) => {
      const raw = String(p ?? '');
      if (!raw) return '';
      return relativeToWorkspace(raw, ws);
    };
    switch (toolName) {
      case 'write_file':
        return `write ${showPath(args.path)}`;
      case 'run_shell':
        return `$ ${args.command ?? ''}\ncwd: ${abbreviateHome(ws)}`;
      case 'query_db':
        return `db: ${showPath(args.path)}\n${args.query ?? ''}`;
      case 'read_file':
        return `read ${showPath(args.path)}`;
      case 'list_dir':
        return `list ${showPath(args.path ?? '.')}`;
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

  /**
   * Offer fix / skip / retry after a failure. Spec §9: the app never auto-retries
   * or auto-feeds an error back without the user choosing.
   */
  async function waitForFailureChoice(activityId: string, toolName: string): Promise<FailureChoice | null> {
    return new Promise<FailureChoice | null>((resolve) => {
      setPendingFailure({ activityId, toolName });
      setFailureResolve(() => resolve);
    });
  }

  function handleFailureChoice(choice: FailureChoice | undefined) {
    if (!choice) return;
    const resolve = failureResolve;
    const pending = pendingFailure;
    setPendingFailure(null);
    setFailureResolve(null);
    if (pending) {
      logger.log({ event: 'tool_choice', activityId: pending.activityId, choice });
    }
    resolve?.(choice);
  }

  function handlePermissionDecision(action: PermissionAction) {
    const resolve = pendingToolResolve;
    const tool = pendingTool;
    if (resolve) {
      resolve(action === 'allow' || action === 'always_allow');
    }
    if (tool) {
      if (action === 'always_allow') {
        // "Always allow" is the same switch as /autoapprove all, so the status
        // line and log stay consistent with the command.
        setAutoApprove('all');
        addSystemMessage('Auto-approve set to all for the rest of this session.');
        logger.log({ event: 'set_auto_approve', mode: 'all', via: 'approval' });
      } else if (action === 'deny') {
        patch(tool.activityId, { status: 'denied' });
        logger.log({ event: 'tool_denied', toolCallId: tool.callId, tool: tool.toolName });
      } else {
        logger.log({ event: 'tool_approved', toolCallId: tool.callId, tool: tool.toolName });
      }
    }
    setPendingTool(null);
    setPendingToolResolve(null);
  }

  /** Pre-compute the write_file diff so re-renders stay cheap. */
  async function attachDiff(activity: ToolActivity): Promise<ToolActivity> {
    if (activity.toolName !== 'write_file') return activity;
    const probe = await probeExistingFile(String(activity.args.path ?? ''), {
      workspace: workspaceRef.current,
      maxResultBytes: config.maxResultBytes,
      shellTimeoutMs: config.shellTimeoutMs,
    });
    const next: ToolActivity = { ...activity, fileState: probe.kind };
    if (probe.kind === 'existing') {
      next.diff = computeDiffLines(probe.content ?? '', String(activity.args.content ?? ''));
    }
    return next;
  }

  async function runToolActivity(
    activity: ToolActivity,
    epoch: number,
  ): Promise<{ content: string; ok: boolean }> {
    const startedAt = Date.now();
    patch(activity.id, { status: 'running', startedAt });

    const ctx = buildToolContext(activity.id);
    const result = await executeToolCall(
      {
        id: activity.callId,
        type: 'function',
        function: { name: activity.toolName, arguments: JSON.stringify(activity.args) },
      },
      ctx,
    );
    releaseToolController(activity.id);

    if (generationEpochRef.current !== epoch) {
      return { content: 'Tool call was cancelled before completing.', ok: false };
    }

    const durationMs = Date.now() - startedAt;

    if (result.cancelled) {
      patch(activity.id, {
        status: 'cancelled',
        durationMs,
        error: 'Cancelled by user',
        label: 'execution_error',
      });
      logger.log({ event: 'tool_cancelled', toolCallId: activity.callId, tool: activity.toolName });
      return { content: 'Tool call was cancelled by the user.', ok: false };
    }

    if (result.error) {
      patch(activity.id, {
        status: 'failed',
        durationMs,
        error: result.error,
        label: result.label ?? 'execution_error',
      });
      logger.log({
        event: 'tool_error',
        toolCallId: activity.callId,
        tool: activity.toolName,
        error: result.error,
        label: result.label ?? 'execution_error',
      });
      return { content: `Error: ${result.error}`, ok: false };
    }

    patch(activity.id, {
      status: 'success',
      durationMs,
      output: result.output,
      trimmed: result.trimmed,
    });
    logger.log({
      event: 'tool_success',
      toolCallId: activity.callId,
      tool: activity.toolName,
      durationMs,
      trimmed: result.trimmed,
      output: result.output?.slice(0, 4000),
    });
    return { content: result.output ?? '', ok: true };
  }

  async function resumeGeneration(initialHistory: ConversationMessage[]) {
    const epoch = ++generationEpochRef.current;
    const repairedHistory = fillMissingToolResults(initialHistory);
    setMessages(repairedHistory);
    setGenerating(true);
    setPartial('');
    setPendingTool(null);
    toolCallsRef.current = [];

    let history = repairedHistory;
    // Wall-clock spent streaming. Tracked per stream so multi-turn tool loops
    // accumulate each leg exactly once (a fixed start instant here would re-add
    // the whole elapsed span on every iteration and inflate the tok/s figure).
    let streamStartedAt = Date.now();

    try {
      while (true) {
        if (generationEpochRef.current !== epoch) return;
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        streamStartedAt = Date.now();

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
            onUsage(usage) {
              setPromptTokens(usage.promptTokens);
              setCompletionTokens((prev) => prev + usage.completionTokens);
            },
          },
        );

        abortControllerRef.current = null;
        if (generationEpochRef.current !== epoch) return;

        setGenerationMs((prev) => prev + (Date.now() - streamStartedAt));

        const assistantContent = result.content ?? partial;
        const assistantMsg: ConversationMessage = {
          role: 'assistant',
          content: assistantContent,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        };

        if (result.toolCalls.length > 0) {
          assistantMsg.tool_calls = result.toolCalls.map((tc, i) => ({
            id: tc.id || `call_${Date.now()}_${i}`,
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
          usage: result.usage,
        });

        if (result.toolCalls.length === 0) break;

        // --- Build activities for every call in this turn ---
        const turnActivities: ToolActivity[] = [];
        let invalid = false;

        for (const [i, tc] of result.toolCalls.entries()) {
          const callId = assistantMsg.tool_calls?.[i]?.id ?? `call_${Date.now()}_${i}`;
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

          turnActivities.push({
            id: `${callId}-${i}`,
            callId,
            toolName,
            args,
            status: validation.valid ? 'awaiting_approval' : 'failed',
            formatValid: validation.valid,
            formatError: validation.error,
            label: validation.label,
            error: validation.valid ? undefined : validation.error,
            startedAt: Date.now(),
          });

          if (!validation.valid) {
            invalid = true;
            logger.log({
              event: 'tool_call',
              toolCallId: callId,
              tool: toolName,
              args,
              validation: 'invalid',
              label: validation.label,
              error: validation.error,
            });
          }
        }

        setActivities((prev) => [...prev, ...turnActivities]);

        // A malformed call must PAUSE the turn so the user can fix/skip/retry
        // rather than letting dangling tool_calls reach the next request.
        if (invalid) {
          const bad = turnActivities.find((a) => !a.formatValid);
          if (bad) {
            const choice = await waitForFailureChoice(bad.id, bad.toolName);
            if (generationEpochRef.current !== epoch) return;
            await resolveFailure(bad, choice, history, epoch);
          }
          return;
        }

        // --- Approval ---
        const approvedActivities: ToolActivity[] = [];
        const deniedActivities: ToolActivity[] = [];

        for (const activity of turnActivities) {
          const readOnly = tools[activity.toolName]?.isReadOnly ?? false;
          if (shouldAutoApprove(autoApprove, readOnly)) {
            approvedActivities.push({ ...activity, autoApproved: true });
            patch(activity.id, { autoApproved: true });
            logger.log({
              event: 'tool_auto_approved',
              toolCallId: activity.callId,
              tool: activity.toolName,
              mode: autoApprove,
            });
            continue;
          }

          const withDiff = await attachDiff(activity);
          if (withDiff.diff || withDiff.fileState) {
            setActivities((prev) => patchActivity(prev, activity.id, {
              diff: withDiff.diff,
              fileState: withDiff.fileState,
            }));
          }

          const ok = await waitForApproval({
            callId: activity.callId,
            activityId: activity.id,
            toolName: activity.toolName,
            args: activity.args,
          });

          if (generationEpochRef.current !== epoch) return;

          if (ok) approvedActivities.push(withDiff);
          else deniedActivities.push(withDiff);
        }

        // --- Execute approved tools in parallel ---
        const outcomes = await Promise.all(
          approvedActivities.map((a) => runToolActivity(a, epoch)),
        );

        if (generationEpochRef.current !== epoch) return;

        const byCallId = new Map<string, { content: string; ok: boolean }>();
        approvedActivities.forEach((a, i) => byCallId.set(a.callId, outcomes[i]));

        history = [...history];
        for (const activity of turnActivities) {
          const denied = deniedActivities.find((d) => d.callId === activity.callId);
          if (denied) {
            history.push({
              role: 'tool',
              tool_call_id: activity.callId,
              content: 'Tool call denied by user.',
            });
            continue;
          }
          const outcome = byCallId.get(activity.callId);
          if (outcome) {
            history.push({ role: 'tool', tool_call_id: activity.callId, content: outcome.content });
          }
        }
        setMessages(history);

        // --- Offer fix/skip/retry for the first failed execution ---
        const failed = approvedActivities
          .map((a, i) => ({ activity: a, outcome: outcomes[i] }))
          .find((o) => !o.outcome.ok);

        if (failed) {
          const choice = await waitForFailureChoice(failed.activity.id, failed.activity.toolName);
          if (generationEpochRef.current !== epoch) return;
          await resolveFailure(failed.activity, choice, history, epoch, failed.outcome.content);
          return;
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

  /**
   * Handle the user's answer to a failed tool call.
   * fix  → feed the error back to the model so it can try another approach
   * skip → tell the model it was skipped and continue
   * retry→ run the exact same call again
   */
  async function resolveFailure(
    activity: ToolActivity,
    choice: FailureChoice | null,
    history: ConversationMessage[],
    epoch: number,
    lastError?: string,
  ) {
    if (choice === null) return; // cancelled

    const errorText = lastError ?? activity.error ?? 'The tool call failed.';
    // Upsert rather than append: the malformed-call path has no tool message for
    // this id yet (the turn paused before execution), while the failed-execution
    // path already pushed the error result. Appending in that second case would
    // emit two tool messages for one tool_call_id, which the API rejects.
    let next = upsertToolResult(history, activity.callId, resultFor(choice, errorText));

    if (choice === 'skip') patch(activity.id, { status: 'skipped' });

    if (choice === 'retry') {
      const again = await runToolActivity({ ...activity, status: 'running' }, epoch);
      if (generationEpochRef.current !== epoch) return;
      next = upsertToolResult(next, activity.callId, again.content);
    }

    if (generationEpochRef.current !== epoch) return;
    await resumeGeneration(next);
  }

  /** Append or replace the `role:'tool'` message matching `callId`. */
  function upsertToolResult(
    history: ConversationMessage[],
    callId: string,
    content: string,
  ): ConversationMessage[] {
    const next = [...history];
    const at = next.findIndex((m) => m.role === 'tool' && m.tool_call_id === callId);
    if (at >= 0) next[at] = { role: 'tool', tool_call_id: callId, content };
    else next.push({ role: 'tool', tool_call_id: callId, content });
    setMessages(next);
    return next;
  }

  async function generate(userInput: string) {
    const userMsg: ConversationMessage = { role: 'user', content: userInput };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    logger.log({ event: 'user_message', content: userInput });
    await resumeGeneration(newHistory);
  }

  async function setModelAndCheck(nextModel: string) {
    setModel(nextModel);
    addSystemMessage(`Model set to ${nextModel}.`);
    logger.log({ event: 'set_model', model: nextModel, via: 'command' });
    try {
      const installed = await listInstalledModels(config.baseUrl);
      if (installed.length > 0 && !installed.some((m) => m.name === nextModel)) {
        addSystemMessage(`Warning: "${nextModel}" is not installed. Run: ollama pull ${nextModel}`);
      }
      if (!(await checkToolSupport(config.baseUrl, nextModel))) {
        addSystemMessage(`Warning: ${nextModel} does not advertise tool support.`);
      }
    } catch {
      // best-effort
    }
  }

  async function changeWorkspace(requested: string) {
    if (generating || pendingTool || pendingFailure) {
      addSystemMessage('Cannot change workspace while a generation or tool prompt is active. Press Ctrl+C first.');
      return;
    }
    const result = await resolveWorkspace(requested, workspaceRef.current);
    if (!result.ok) {
      addSystemMessage(`Workspace unchanged: ${result.error}`);
      logger.log({ event: 'workspace_error', path: requested, error: result.error });
      return;
    }
    setWorkspace(result.path);
    addSystemMessage(`Workspace: ${abbreviateHome(result.path)}`);
    logger.log({ event: 'set_workspace', workspace: result.path });
  }

  function currentStats() {
    return computeStats(
      {
        model,
        temperature,
        systemPrompt,
        workspace,
        startedAt: startedAtRef.current,
        logPath: logger.path,
        promptTokens,
        completionTokens,
        generationMs,
      },
      messages,
      activities,
    );
  }

  /**
   * Command dispatcher. Typed as a full `Record` over `CommandActionType`, so a
   * new action without a handler is a compile error — the drift that silently
   * broke seven commands after the Phase 12 migration cannot recur.
   */
  const commandHandlers: Record<CommandAction['type'], (action: CommandAction) => void | Promise<void>> = {
    error: (action) => {
      if (action.type === 'error') addSystemMessage(action.message);
    },
    clear: () => {
      setMessages([]);
      setPartial('');
      setError(null);
      setActivities([]);
      setPromptTokens(0);
      setCompletionTokens(0);
      setGenerationMs(0);
      startedAtRef.current = Date.now();
      logger.log({ event: 'clear' });
    },
    'set-system': (action) => {
      if (action.type !== 'set-system') return;
      setSystemPrompt(action.prompt);
      addSystemMessage(action.prompt ? 'System prompt updated.' : 'System prompt cleared.');
      logger.log({ event: 'set_system_prompt', prompt: action.prompt });
    },
    'set-model': (action) => {
      if (action.type !== 'set-model') return;
      void setModelAndCheck(action.model);
    },
    'set-temperature': (action) => {
      if (action.type !== 'set-temperature') return;
      setTemperature(action.temperature);
      addSystemMessage(`Temperature set to ${action.temperature.toFixed(1)}.`);
      logger.log({ event: 'set_temperature', temperature: action.temperature });
    },
    'set-autoapprove': (action) => {
      if (action.type !== 'set-autoapprove') return;
      setAutoApprove(action.mode);
      addSystemMessage(`Auto-approve: ${action.mode}.`);
      logger.log({ event: 'set_auto_approve', mode: action.mode, via: 'command' });
    },
    'show-autoapprove': () => {
      addSystemMessage(`Auto-approve is "${autoApprove}" (none | read-only | all).`);
    },
    'toggle-compact': () => {
      const next = !compact;
      setCompact(next);
      addSystemMessage(next ? 'Completed tool rows collapsed.' : 'All tool rows expanded.');
      logger.log({ event: 'set_tool_compact', compact: next, via: 'command' });
    },
    'set-workspace': (action) => {
      if (action.type !== 'set-workspace') return;
      void changeWorkspace(action.path);
    },
    'show-workspace': () => {
      addSystemMessage(`Workspace: ${abbreviateHome(workspace)}\n(launch directory: ${abbreviateHome(config.workspace)})`);
    },
    retry: async () => {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser && lastUser.role === 'user') {
        cleanupGeneration();
        await generate(lastUser.content);
      } else {
        addSystemMessage('No user message to retry.');
      }
    },
    'list-models': async () => {
      try {
        const models = await listInstalledModels(config.baseUrl);
        if (models.length === 0) {
          addSystemMessage('No models installed. Run: ollama pull qwen3:4b');
          return;
        }
        addSystemMessage(`Installed models:\n${models.map((m) => `  ${m.name}`).join('\n')}`);
      } catch {
        addSystemMessage('Could not list models.');
      }
    },
    stats: () => {
      const s = currentStats();
      const lines = [
        `Model: ${s.model || '—'} · temp ${s.temperature} · auto:${autoApprove}`,
        `Workspace: ${abbreviateHome(s.workspace)}`,
        `Messages: ${s.messages} (${s.userMessages} user / ${s.assistantMessages} assistant / ${s.toolMessages} tool)`,
        `Context: ~${contextTokens} of ${maxContextTokens} tokens`,
        `Tokens: ${s.promptTokens} prompt / ${s.completionTokens} completion`,
        `Speed: ${s.tokensPerSecond === null ? '—' : `${s.tokensPerSecond} tok/s`}`,
        `Tools: ✔ ${s.toolSuccess} ✖ ${s.toolFailed} · denied ${s.toolDenied} · skipped ${s.toolSkipped} · cancelled ${s.toolCancelled}`,
        `Avg tool time: ${s.avgToolMs === null ? '—' : `${Math.round(s.avgToolMs)} ms`}`,
        `Log: ${s.logPath}`,
      ];
      addSystemMessage(lines.join('\n'));
    },
    export: () => {
      try {
        const s = currentStats();
        const files = exportReport(config, s, messages, activities);
        addSystemMessage(
          `Exported:\n  ${relativeToWorkspace(files.markdownPath, workspace)}\n  ${relativeToWorkspace(files.jsonPath, workspace)}`,
        );
        logger.log({ event: 'export', markdown: files.markdownPath, json: files.jsonPath });
      } catch (err) {
        addSystemMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    save: async (action) => {
      if (action.type !== 'save') return;
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastUser || lastUser.role !== 'user') {
        addSystemMessage('Nothing to save — send a prompt first.');
        return;
      }
      try {
        await saveTestCase(config, action.name, lastUser.content, systemPrompt);
        addSystemMessage(`Saved test case "${action.name}".`);
        logger.log({ event: 'save_case', name: action.name });
      } catch (err) {
        addSystemMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    load: async (action) => {
      if (action.type !== 'load') return;
      try {
        const testCase = await loadTestCase(config, action.name);
        setInputValue(testCase.prompt);
        if (testCase.systemPrompt) {
          setSystemPrompt(testCase.systemPrompt);
          addSystemMessage(`Loaded "${action.name}" (system prompt updated).`);
        } else {
          addSystemMessage(`Loaded "${action.name}" — press Enter to send.`);
        }
        logger.log({ event: 'load_case', name: action.name });
      } catch {
        addSystemMessage(`No saved case "${action.name}". Use /save <name> first.`);
      }
    },
    cancel: () => {
      if (generating) cancelGeneration();
      else addSystemMessage('Nothing to cancel.');
    },
  };

  async function handleSubmit(raw: string) {
    const value = raw.trim();
    if (!value) return;

    // PromptInput is fully controlled here, so it cannot clear itself the way the
    // kit's REPL did. Without this the submitted text stays in the box and the
    // next message appends to it.
    setInputValue('');

    setInputHistory((prev) => [value, ...prev].slice(0, 50));

    if (value.startsWith('/')) {
      logger.log({ event: 'command', command: value });
      const action = parseCommand(value);
      await commandHandlers[action.type](action);
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
    setActivities([]);
    setModel(newModel);
    addSystemMessage(`Model set to ${newModel}. Ready to chat.`);
    addSystemMessage(`Workspace: ${abbreviateHome(workspaceRef.current)}`);
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
  const paletteRows = paletteVisible
    ? Math.min(6, suggestions.length) +
      2 +
      (windowStart(suggestions.length, paletteIndex) > 0 ? 1 : 0) +
      (windowStart(suggestions.length, paletteIndex) + Math.min(6, suggestions.length) <
      suggestions.length
        ? 1
        : 0)
    : 0;

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

  // Collapse/expand completed tool rows while a turn is in flight.
  useInput((input, _key, event) => {
    if (!generating || activities.length === 0) return;
    if (input === 'c') {
      event.stopImmediatePropagation();
      const next = !compact;
      setCompact(next);
      logger.log({ event: 'set_tool_compact', compact: next, via: 'hotkey' });
    }
  });

  // Failure choices: [f] fix  [s] skip  [r] retry
  useInput(
    (input, _key, event) => {
      if (!pendingFailure) return;
      if (input === 'f' || input === 's' || input === 'r') {
        event.stopImmediatePropagation();
        handleFailureChoice(FAILURE_KEY_TO_CHOICE[input]);
      }
    },
    { isActive: !!pendingFailure },
  );

  useInput(
    (input, key, event) => {
      if (key.ctrl && input === 'c') {
        if (generating) {
          event.stopImmediatePropagation();
          cancelGeneration();
        } else if (pendingTool) {
          event.stopImmediatePropagation();
          handlePermissionDecision('deny');
        } else if (pendingFailure) {
          event.stopImmediatePropagation();
          setPendingFailure(null);
          failureResolve?.(null);
          setFailureResolve(null);
        }
      }
    },
    { captureCtrlC: generating || !!pendingTool || !!pendingFailure },
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

  async function copyWorkspacePath() {
    const ok = await copyToClipboard(workspace);
    setCopiedAt(Date.now());
    addSystemMessage(ok ? `Copied workspace path: ${workspace}` : 'Clipboard unavailable in this terminal.');
  }

  const statusSegments: StatusLineSegment[] = [
    { content: connected ? 'connected' : 'disconnected', color: connected ? colors.accentBright : colors.accent },
    { content: `temp ${temperature.toFixed(1)}`, color: 'dim' },
    ...(autoApprove !== 'none' ? [{ content: `auto:${autoApprove}`, color: colors.warning } as StatusLineSegment] : []),
    { content: 'Ctrl+T thinking', color: 'dim' },
    { content: 'Ctrl+C cancel', color: 'dim' },
  ];

  const viewportHeight = Math.max(
    3,
    rows - 7 - paletteRows - (pendingTool ? 8 : 0) - (pendingFailure ? 3 : 0),
  );

  const welcome = (
    <XakuWelcome
      model={model}
      connected={connected}
      temperature={temperature}
      workspace={abbreviateHome(workspace)}
    />
  );

  if (menuActive) {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <XakuMenu
          baseUrl={config.baseUrl}
          currentModel={model}
          workspace={abbreviateHome(workspace)}
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
        toolSuccess={activities.filter((a) => a.status === 'success').length}
        toolFail={activities.filter((a) => a.status === 'failed').length}
        gitBranch={gitBranch}
        workspace={abbreviateHome(workspace)}
        onCopyWorkspace={() => void copyWorkspacePath()}
        copiedAt={copiedAt}
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
      <ToolPanel activities={activities} workspace={workspace} compact={compact} />
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
      {pendingFailure ? (
        <Box paddingX={1} flexDirection="column">
          <Text color={colors.error}>
            ✖ {pendingFailure.toolName} failed — [f] fix  [s] skip  [r] retry
          </Text>
          <Text dimColor>
            fix sends the error back to the model · skip continues · retry re-runs the call
          </Text>
        </Box>
      ) : pendingTool ? (
        <PermissionRequest
          toolName={pendingTool.toolName}
          description={`Run ${pendingTool.toolName}?`}
          details={buildPreview(pendingTool.toolName, pendingTool.args)}
          showAlwaysAllow
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
