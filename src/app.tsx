import { Box, Text, useInput, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { estimateContextTokens, estimateTokens, fillMissingToolResults, toOpenAIMessages, type ConversationMessage, type UserMessage } from './model/session.js';
import { createLogger } from './logger.js';
import { exportSession, exportComparison } from './commands/report.js';
import { saveTestCase, loadTestCase } from './commands/cases.js';
import { runBenchmark, type BenchmarkResult } from './model/benchmark.js';
import { runComparison, autoSpeedScore, emptyRatings, emptySide, DIMENSIONS, type CompareResult, type CompareSideResult, type CompareToolActivity, type ComparisonScore, type Dimension, type ModelRatings } from './model/compare.js';
import { BenchmarkPanel } from './ui/BenchmarkPanel.js';
import { ComparePanel } from './ui/ComparePanel.js';
import { listSessions, loadSession, reconstructUpTo, type LogEvent, type SessionSummary } from './model/replay.js';
import { formatReplaySpeed, nextSpeed, replayIntervalMs } from './ui/replay-controls.js';
import { SessionPicker } from './ui/SessionPicker.js';
import { ChatPanel } from './ui/ChatPanel.js';
import { InputLine } from './ui/InputLine.js';
import { StatsBar } from './ui/StatsBar.js';
import { TopBar } from './ui/TopBar.js';
import { ToolPanel } from './ui/ToolPanel.js';
import type { ToolActivity } from './ui/ToolActivity.js';
import { useScrollback } from './ui/useScrollback.js';
import { validateToolCall, executeToolCall, getToolDefinitions } from './tools/executor.js';
import { tools } from './tools/registry.js';
import { probeExistingFile, type ExistingFileKind } from './tools/utils.js';
import { computeDiffLines, formatDiffSummary, type DiffResult } from './ui/diff.js';
import type { ToolContext } from './tools/types.js';

export interface AppProps {
  config: Config;
}

interface BenchmarkState {
  testCaseName: string;
  models: string[];
  results: BenchmarkResult[];
  running: boolean;
  currentModel: string | null;
}

interface CompareState {
  testCaseName: string;
  leftModel: string;
  rightModel: string;
  running: boolean;
  leftResult: CompareSideResult;
  rightResult: CompareSideResult;
  leftPartial: string;
  rightPartial: string;
  leftReasoning: string;
  rightReasoning: string;
  score?: ComparisonScore;
  ratingMode: boolean;
  ratingSide: 'left' | 'right';
  ratingDimension: Dimension;
}

type ReplayState =
  | { view: 'picker'; sessions: SessionSummary[]; selected: number }
  | { view: 'play'; fileName: string; events: LogEvent[]; cursor: number; speed: number; playing: boolean };

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
  const [toolCompact, setToolCompact] = useState(false);
  // Activity ids awaiting approval in the current batch (multiple tools can be
  // pending at once; the user approves/denies as a batch or focuses one item).
  const [pendingBatch, setPendingBatch] = useState<string[]>([]);
  const [focusedActivity, setFocusedActivity] = useState<string | null>(null);
  const [autoApprove, setAutoApproveState] = useState<AutoApproveMode>(config.autoApprove);
  const autoApproveRef = useRef<AutoApproveMode>(config.autoApprove);

  const [bench, setBench] = useState<BenchmarkState | null>(null);
  const benchControllerRef = useRef<AbortController | null>(null);
  const [compare, setCompare] = useState<CompareState | null>(null);
  const compareControllerRef = useRef<AbortController | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [chatHeights, setChatHeights] = useState({ contentHeight: 0, containerHeight: 0 });

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

  const maxScrollLine = Math.max(0, chatHeights.contentHeight - chatHeights.containerHeight);
  const scrollback = useScrollback(maxScrollLine, Math.max(1, chatHeights.containerHeight), chatHeights.contentHeight);

  const handleChatMeasured = useCallback((heights: { contentHeight: number; containerHeight: number }) => {
    setChatHeights(heights);
  }, []);

  // Trackpad/mouse wheel: 3 rows per notch, same semantics as ↑/↓. Handled
  // inside ChatPanel (which also routes clicks on reasoning headers).
  const WHEEL_ROWS = 3;
  function handleWheel(direction: 'up' | 'down') {
    if (replay || bench || compare) return;
    if (direction === 'up') {
      scrollback.up(WHEEL_ROWS);
    } else {
      scrollback.down(WHEEL_ROWS);
    }
  }

  // Reasoning blocks are collapsed by default; this set holds the expanded ones.
  const [expandedReasoning, setExpandedReasoning] = useState<Set<number>>(() => new Set());
  const toggleReasoning = useCallback((index: number) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

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
  const hasToolPrompt = pendingBatch.length > 0 || hasFailedTool;
  const connectionError = !!error && error.includes('press Enter to retry');
  // Idle + empty input: arrow/PgUp/PgDn keys are not claimed by InputLine or
  // the CommandMenu, so scrollback can use them freely.
  const scrollActive = !generating && !hasToolPrompt && !connectionError && input === '';

  useInput(
    (char, key) => {
      if (compare) {
        if (key.escape) {
          if (compare.ratingMode) {
            setCompare({ ...compare, ratingMode: false });
          } else if (compare.running) {
            cancelComparison();
          } else {
            setCompare(null);
          }
        } else if (compare.running) {
          return;
        } else if (compare.ratingMode) {
          if (/^[1-5]$/.test(char)) {
            const score = compare.score;
            if (!score) return;
            const val = Number(char);
            if (compare.ratingSide === 'left') {
              const newRatings = { ...score.left.ratings, [compare.ratingDimension]: val };
              setCompare({ ...compare, score: { ...score, left: { ...score.left, ratings: newRatings } } });
            } else {
              const newRatings = { ...score.right.ratings, [compare.ratingDimension]: val };
              setCompare({ ...compare, score: { ...score, right: { ...score.right, ratings: newRatings } } });
            }
            logger.log({ event: 'compare_rate', side: compare.ratingSide, dimension: compare.ratingDimension, value: val });
          } else if (key.leftArrow) {
            const idx = DIMENSIONS.indexOf(compare.ratingDimension);
            const prev = DIMENSIONS[(idx - 1 + DIMENSIONS.length) % DIMENSIONS.length];
            setCompare({ ...compare, ratingDimension: prev });
          } else if (key.rightArrow) {
            const idx = DIMENSIONS.indexOf(compare.ratingDimension);
            const next = DIMENSIONS[(idx + 1) % DIMENSIONS.length];
            setCompare({ ...compare, ratingDimension: next });
          } else if (key.upArrow || key.downArrow) {
            setCompare({ ...compare, ratingSide: compare.ratingSide === 'left' ? 'right' : 'left' });
          } else if (key.return) {
            const idx = DIMENSIONS.indexOf(compare.ratingDimension);
            const next = DIMENSIONS[(idx + 1) % DIMENSIONS.length];
            const nextSide = compare.ratingDimension === DIMENSIONS[DIMENSIONS.length - 1]
              ? (compare.ratingSide === 'left' ? 'right' : 'left')
              : compare.ratingSide;
            setCompare({ ...compare, ratingDimension: next, ratingSide: nextSide });
          }
        } else {
          if (char === 'r') {
            setCompare({ ...compare, ratingMode: true });
          }
        }
        return;
      }

      if (replay) {
        if (key.escape) {
          setReplay(null);
        } else if (replay.view === 'picker') {
          if (key.upArrow) {
            setReplay({ ...replay, selected: Math.max(0, replay.selected - 1) });
          } else if (key.downArrow) {
            setReplay({ ...replay, selected: Math.min(replay.sessions.length - 1, replay.selected + 1) });
          } else if (key.return) {
            void openReplaySession(replay.sessions[replay.selected]);
          }
        } else {
          const total = replay.events.length;
          if (key.rightArrow) {
            // Manual steps pause auto-play so the user can inspect.
            setReplay({ ...replay, cursor: Math.min(total - 1, replay.cursor + 1), playing: false });
          } else if (key.leftArrow) {
            setReplay({ ...replay, cursor: Math.max(0, replay.cursor - 1), playing: false });
          } else if (key.pageUp) {
            setReplay({ ...replay, cursor: 0, playing: false });
          } else if (key.pageDown) {
            setReplay({ ...replay, cursor: Math.max(0, total - 1), playing: false });
          } else if (char === '+' || char === '=') {
            setReplay({ ...replay, speed: nextSpeed(replay.speed, 1), playing: true });
          } else if (char === '-') {
            setReplay({ ...replay, speed: nextSpeed(replay.speed, -1), playing: true });
          } else if (char === ' ' || char === 'p') {
            if (replay.playing) {
              setReplay({ ...replay, playing: false });
            } else {
              const atEnd = replay.cursor >= total - 1;
              setReplay({ ...replay, cursor: atEnd ? 0 : replay.cursor, playing: true });
            }
          }
        }
        return;
      }

      // Ctrl+T: show/hide the most recent model thinking — a keyboard fallback
      // for the clickable `thinking [+/−]` header when terminal clicks don't
      // reach us (non-SGR mice, odd coordinate bases).
      if (key.ctrl && char === 't') {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i];
          if (m.role === 'assistant' && m.reasoning) {
            toggleReasoning(i);
            break;
          }
        }
        return;
      }

      if (key.upArrow) {
        scrollback.up();
        return;
      }
      if (key.downArrow) {
        scrollback.down();
        return;
      }
      if (key.pageUp) {
        scrollback.pageUp();
        return;
      }
      if (key.pageDown) {
        scrollback.pageDown();
        return;
      }

      if (key.escape) {
        if (focusedActivity) {
          setFocusedActivity(null);
          return;
        }
        if (bench?.running) {
          cancelBenchmark();
          return;
        }
        if (bench) {
          setBench(null);
          return;
        }
        if (scrollback.isScrolled) {
          scrollback.end();
          return;
        }
        if (generating) {
          cancelGeneration();
          return;
        }
      }

      if (char === 't' && generating) {
        cycleAutoApprove();
        return;
      }

      if (char === 'c' && (generating || hasToolPrompt) && toolActivities.length > 0) {
        toggleToolCompact();
        return;
      }

      if (pendingBatch.length > 0) {
        if (focusedActivity) {
          if (char === 'a') {
            approveToolCall(focusedActivity);
            return;
          }
          if (char === 'd') {
            denyToolCall(focusedActivity);
            return;
          }
        } else if (char === 'a') {
          for (const id of [...pendingBatch]) approveToolCall(id);
          return;
        } else if (char === 'd') {
          for (const id of [...pendingBatch]) denyToolCall(id);
          return;
        } else if (/^[1-9]$/.test(char)) {
          const target = pendingBatch[Number(char) - 1];
          if (target) setFocusedActivity(target);
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
    { isActive: generating || hasToolPrompt || connectionError || scrollActive || bench !== null || compare !== null || replay !== null || scrollback.isScrolled },
  );

  // Any typed character leaves scrollback and returns to the live tail.
  useEffect(() => {
    if (input !== '') {
      if (scrollback.isScrolled) {
        scrollback.end();
      }
      if (bench && !bench.running) {
        setBench(null);
      }
      if (compare && !compare.running) {
        setCompare(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

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
    setPendingBatch([]);
    setFocusedActivity(null);
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
    setPendingBatch((prev) => prev.filter((id) => id !== activityId));
    setFocusedActivity((prev) => (prev === activityId ? null : prev));
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
    setPendingBatch((prev) => prev.filter((id) => id !== activityId));
    setFocusedActivity((prev) => (prev === activityId ? null : prev));
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'denied' } : a)),
    );
  }

  function applyAutoApprove(mode: AutoApproveMode, via: 'command' | 'hotkey') {
    setAutoApprove(mode);
    logger.log({ event: 'set_auto_approve', mode, via });
    // Any pending tool covered by the new mode is approved immediately.
    for (const activityId of [...pendingBatch]) {
      const activity = toolActivities.find((a) => a.id === activityId);
      if (activity && (mode === 'all' || (mode === 'read-only' && tools[activity.toolName]?.isReadOnly))) {
        approveToolCall(activityId);
      }
    }
  }

  function cycleAutoApprove() {
    const idx = AUTO_APPROVE_MODES.indexOf(autoApproveRef.current);
    const next = AUTO_APPROVE_MODES[(idx + 1) % AUTO_APPROVE_MODES.length];
    addSystemMessage(`Auto-approve: ${next}.`);
    applyAutoApprove(next, 'hotkey');
  }

  function toggleToolCompact(via: 'hotkey' | 'command' = 'hotkey') {
    const next = !toolCompact;
    setToolCompact(next);
    logger.log({ event: 'set_tool_compact', compact: next, via });
  }

  function startBenchmark(models: string[], testCaseName: string, testCase: { prompt: string; systemPrompt: string | null }) {
    cleanupGeneration();
    const controller = new AbortController();
    benchControllerRef.current = controller;
    setToolActivities([]);
    setBench({ testCaseName, models, results: [], running: true, currentModel: models[0] });
    addSystemMessage(`Benchmark started: ${models.length} model(s) on "${testCaseName}". Esc cancels.`);
    logger.log({ event: 'benchmark_start', case: testCaseName, models });

    runBenchmark(models, {
      client,
      testCase,
      temperature,
      systemPrompt,
      toolCtx: {
        workspace: config.workspace,
        maxResultBytes: config.maxResultBytes,
        shellTimeoutMs: config.shellTimeoutMs,
      },
      signal: controller.signal,
      onModelStart: (model, _index, _total) => {
        setBench((prev) => (prev ? { ...prev, currentModel: model } : prev));
      },
      onModelEnd: (result) => {
        setBench((prev) => (prev ? { ...prev, results: [...prev.results, result] } : prev));
      },
    })
      .then((results) => {
        setBench((prev) => (prev ? { ...prev, results, running: false, currentModel: null } : prev));
        logger.log({
          event: 'benchmark_end',
          case: testCaseName,
          results: results.map((r) => ({ model: r.model, status: r.status, totalTimeMs: r.totalTimeMs })),
        });
      })
      .finally(() => {
        benchControllerRef.current = null;
      });
  }

  function cancelBenchmark() {
    benchControllerRef.current?.abort();
    setBench((prev) => (prev ? { ...prev, running: false, currentModel: null } : prev));
    logger.log({ event: 'benchmark_cancelled' });
    addSystemMessage('Benchmark cancelled.');
  }

  function startComparison(leftModel: string, rightModel: string, testCaseName: string, testCase: { prompt: string; systemPrompt: string | null }) {
    cleanupGeneration();
    const controller = new AbortController();
    compareControllerRef.current = controller;
    setToolActivities([]);
    setCompare({
      testCaseName,
      leftModel,
      rightModel,
      running: true,
      leftResult: emptySide(leftModel),
      rightResult: emptySide(rightModel),
      leftPartial: '',
      rightPartial: '',
      leftReasoning: '',
      rightReasoning: '',
      score: undefined,
      ratingMode: false,
      ratingSide: 'left',
      ratingDimension: 'accuracy',
    });
    addSystemMessage(`Comparison started: ${leftModel} vs ${rightModel} on "${testCaseName}". Esc cancels.`);
    logger.log({ event: 'compare_start', case: testCaseName, left: leftModel, right: rightModel });

    runComparison(leftModel, rightModel, {
      client,
      testCase,
      temperature,
      systemPrompt,
      toolCtx: {
        workspace: config.workspace,
        maxResultBytes: config.maxResultBytes,
        shellTimeoutMs: config.shellTimeoutMs,
      },
      signal: controller.signal,
      onContent: (side, text) => {
        setCompare((prev) => {
          if (!prev) return prev;
          const key = side === 'left' ? 'leftPartial' : 'rightPartial';
          return { ...prev, [key]: text };
        });
      },
      onReasoning: (side, text) => {
        setCompare((prev) => {
          if (!prev) return prev;
          const key = side === 'left' ? 'leftReasoning' : 'rightReasoning';
          return { ...prev, [key]: text };
        });
      },
      onToolActivity: (side, activity) => {
        setCompare((prev) => {
          if (!prev) return prev;
          const key = side === 'left' ? 'leftResult' : 'rightResult';
          const current = prev[key];
          const existing = current.toolActivities.findIndex((a) => a.id === activity.id);
          const newActivities = [...current.toolActivities];
          if (existing >= 0) {
            newActivities[existing] = activity;
          } else {
            newActivities.push(activity);
          }
          return { ...prev, [key]: { ...current, toolActivities: newActivities } };
        });
      },
    })
      .then((result) => {
        const speedScores = autoSpeedScore(result.left.tokensPerSecond, result.right.tokensPerSecond);
        setCompare((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            running: false,
            leftResult: result.left,
            rightResult: result.right,
            score: {
              left: { model: leftModel, ratings: { ...emptyRatings(), speed: speedScores.left } },
              right: { model: rightModel, ratings: { ...emptyRatings(), speed: speedScores.right } },
            },
          };
        });
        logger.log({
          event: 'compare_end',
          case: testCaseName,
          left: leftModel,
          right: rightModel,
          leftTps: result.left.tokensPerSecond,
          rightTps: result.right.tokensPerSecond,
        });
      })
      .finally(() => {
        compareControllerRef.current = null;
      });
  }

  function cancelComparison() {
    compareControllerRef.current?.abort();
    setCompare((prev) => (prev ? { ...prev, running: false } : prev));
    logger.log({ event: 'compare_cancelled' });
    addSystemMessage('Comparison cancelled.');
  }

  async function openReplaySession(summary: SessionSummary) {
    try {
      const events = await loadSession(config.logsDir, summary.fileName);
      if (events.length === 0) {
        addSystemMessage('Session log is empty.');
        return;
      }
      logger.log({ event: 'replay_open', file: summary.fileName, events: events.length });
      setReplay({ view: 'play', fileName: summary.fileName, events, cursor: 0, speed: 1, playing: false });
    } catch (err) {
      addSystemMessage(`Replay failed to load: ${err instanceof Error ? err.message : String(err)}`);
      setReplay(null);
    }
  }

  const replaySnapshot = useMemo(
    () => (replay?.view === 'play' ? reconstructUpTo(replay.events, replay.cursor) : null),
    [replay],
  );

  const replayPlaying = replay?.view === 'play' && replay.playing;
  const replaySpeed = replay?.view === 'play' ? replay.speed : 1;

  // Auto-play: advance one event per interval while playing; pause at the end.
  useEffect(() => {
    if (!replayPlaying) return;
    const id = setInterval(() => {
      setReplay((prev) => {
        if (prev?.view !== 'play' || !prev.playing) return prev;
        if (prev.cursor >= prev.events.length - 1) return { ...prev, playing: false };
        return { ...prev, cursor: prev.cursor + 1 };
      });
    }, replayIntervalMs(replaySpeed));
    return () => clearInterval(id);
  }, [replayPlaying, replaySpeed]);

  function fixToolCall(activityId: string) {
    const activity = toolActivities.find((a) => a.id === activityId);
    if (!activity) return;
    cleanupGeneration();
    setToolActivities((prev) =>
      prev.map((a) => (a.id === activityId ? { ...a, status: 'skipped' } : a)),
    );
    logger.log({ event: 'tool_choice', toolCallId: activity.toolCallId, tool: activity.toolName, args: activity.arguments, choice: 'fix' });
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
    logger.log({ event: 'tool_choice', toolCallId: activity.toolCallId, tool: activity.toolName, args: activity.arguments, choice: 'skip' });
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
    logger.log({ event: 'tool_choice', toolCallId: activity.toolCallId, tool: activity.toolName, args: activity.arguments, choice: 'retry' });
    resumeGeneration([...messages, toolMsg]);
  }

  async function resumeGeneration(updatedHistory: ConversationMessage[]) {
    const epoch = ++generationEpochRef.current;
    const repairedHistory = fillMissingToolResults(updatedHistory);
    setMessages(repairedHistory);
    setGenerating(true);
    setPartial('');
    setReasoning('');
    setPendingBatch([]);
    setFocusedActivity(null);
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
            messages: toOpenAIMessages(history),
            temperature,
            systemPrompt,
            tools: toolDefs,
            signal: abortController.signal,
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
        const probeCtx: ToolContext = {
          workspace: config.workspace,
          maxResultBytes: config.maxResultBytes,
          shellTimeoutMs: config.shellTimeoutMs,
        };

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

          let fileState: ExistingFileKind | undefined;
          let diff: DiffResult | undefined;
          let preview = buildPreview(toolName, args);

          if (
            toolName === 'write_file' &&
            typeof args.path === 'string' &&
            typeof args.content === 'string'
          ) {
            const probe = await probeExistingFile(args.path, probeCtx);
            fileState = probe.kind;
            if (probe.kind === 'existing' || probe.kind === 'new') {
              diff = computeDiffLines(probe.content ?? '', args.content);
              preview = `path: ${args.path}\n${formatDiffSummary(diff, probe.kind === 'new')}`;
            }
          }

          const activity: ToolActivity = {
            id: `activity_${callId}`,
            toolCallId: callId,
            toolName,
            arguments: args,
            status: validation.valid ? 'awaiting_approval' : 'failed',
            validationError: validation.error,
            preview,
            fileState,
            diff,
          };

          newActivities.push(activity);
          logger.log({
            event: 'tool_call',
            toolCallId: callId,
            tool: toolName,
            args,
            valid: validation.valid,
            validationError: validation.error,
          });
        }

        setToolActivities((prev) => [...prev, ...newActivities]);

        const failedActivities = newActivities.filter((a) => a.status === 'failed');
        if (failedActivities.length > 0) {
          setStats((s) => ({ ...s, toolFail: s.toolFail + failedActivities.length }));
        }

        // Phase 1 — approval. Auto-approved items resolve instantly; manual items
        // wait together as a batch. The user resolves the whole batch with
        // a/d or focuses a single item with 1-9.
        const decisions = new Map<string, boolean>();
        const manualItems: ToolActivity[] = [];

        for (const activity of newActivities) {
          if (activity.status === 'failed') continue;
          if (shouldAutoApprove(activity.toolName)) {
            decisions.set(activity.id, true);
            setToolActivities((prev) =>
              prev.map((a) =>
                a.id === activity.id ? { ...a, status: 'approved', autoApproved: true } : a,
              ),
            );
            logger.log({
              event: 'tool_auto_approved',
              toolCallId: activity.toolCallId,
              tool: activity.toolName,
              args: activity.arguments,
              mode: autoApproveRef.current,
            });
          } else {
            manualItems.push(activity);
          }
        }

        if (manualItems.length > 0) {
          setPendingBatch(manualItems.map((a) => a.id));
          const approvals = await Promise.all(
            manualItems.map(
              (activity) =>
                new Promise<boolean>((resolve) => {
                  approvalResolvers.current.set(activity.id, resolve);
                }),
            ),
          );
          if (generationEpochRef.current !== epoch) return;
          manualItems.forEach((activity, i) => decisions.set(activity.id, approvals[i]));
          setPendingBatch([]);
        }

        // Phase 2 — execute approved tools concurrently. Each executeToolActivity
        // registers its own AbortController, so Esc still cancels mid-flight.
        const runnable = newActivities.filter((a) => decisions.get(a.id) === true);
        const execResults = await Promise.all(runnable.map((a) => executeToolActivity(a)));
        if (generationEpochRef.current !== epoch) return;

        const resultById = new Map<string, Awaited<ReturnType<typeof executeToolActivity>>>();
        runnable.forEach((activity, i) => resultById.set(activity.id, execResults[i]));

        // Tool results go back in the original tool_calls order.
        for (const activity of newActivities) {
          const decision = decisions.get(activity.id);
          if (decision === true) {
            const result = resultById.get(activity.id);
            history = [...history, {
              role: 'tool',
              tool_call_id: activity.toolCallId,
              content: result?.error ? `Error: ${result.error}` : (result?.output || ''),
            }];
          } else if (decision === false) {
            history = [...history, {
              role: 'tool',
              tool_call_id: activity.toolCallId,
              content: 'Tool call denied by user',
            }];
            logger.log({
              event: 'tool_denied',
              toolCallId: activity.toolCallId,
              tool: activity.toolName,
              args: activity.arguments,
            });
          }
        }
        setMessages(history);

        if (failedActivities.length > 0) {
          // Pause for the user's [f]ix/[s]kip/[r]ettry choice on invalid calls;
          // those handlers resume the turn via resumeGeneration. Continuing would
          // send the assistant's tool_calls with missing results to the API.
          return;
        }

        setPartial('');
        setReasoning('');
        setGenerating(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) {
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
        setPendingBatch([]);
        setFocusedActivity(null);
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
        toolCallId: activity.toolCallId,
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
        toolCallId: activity.toolCallId,
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
        toolCallId: activity.toolCallId,
        tool: activity.toolName,
        args: activity.arguments,
        duration,
        trimmed: result.trimmed,
        output: (result.output ?? '').slice(0, 4000),
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
          setExpandedReasoning(new Set());
          setPartial('');
          setError(null);
          setToolCompact(false);
          scrollback.end();
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
        case 'toggle-compact':
          toggleToolCompact('command');
          break;
        case 'benchmark': {
          if (bench?.running) {
            addSystemMessage('A benchmark is already running (Esc to cancel).');
            break;
          }
          try {
            const testCase = await loadTestCase(config, action.name);
            let models = action.models;
            if (!models || models.length === 0) {
              const installed = await listInstalledModels(config.baseUrl);
              models = installed.map((m) => m.name);
            }
            if (models.length === 0) {
              addSystemMessage('No models available to benchmark.');
              break;
            }
            startBenchmark(models, action.name, testCase);
          } catch (err) {
            addSystemMessage(
              `Benchmark failed to start: ${err instanceof Error ? err.message : String(err)}. Save a test case first with /save <name>.`,
            );
          }
          break;
        }
        case 'compare': {
          if (compare) {
            addSystemMessage('Already in comparison mode (Esc to exit).');
            break;
          }
          if (bench?.running) {
            addSystemMessage('A benchmark is already running (Esc to cancel).');
            break;
          }
          try {
            const testCase = await loadTestCase(config, action.name);
            startComparison(action.models[0], action.models[1], action.name, testCase);
          } catch (err) {
            addSystemMessage(
              `Comparison failed to start: ${err instanceof Error ? err.message : String(err)}. Save a test case first with /save <name>.`,
            );
          }
          break;
        }
        case 'replay': {
          if (replay) {
            addSystemMessage('Already in replay mode (Esc to exit).');
            break;
          }
          const sessions = await listSessions(config.logsDir);
          if (sessions.length === 0) {
            addSystemMessage(`No past sessions found in ${config.logsDir}.`);
            break;
          }
          if (action.index && action.index <= sessions.length) {
            await openReplaySession(sessions[action.index - 1]);
          } else {
            setReplay({ view: 'picker', sessions, selected: 0 });
          }
          break;
        }
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
            if (compare && !compare.running) {
              const report = await exportComparison(config, {
                testCaseName: compare.testCaseName,
                prompt: compare.leftResult.messages.find((m) => m.role === 'user')?.content ?? '',
                systemPrompt: systemPrompt,
                leftModel: compare.leftModel,
                rightModel: compare.rightModel,
                leftResult: compare.leftResult,
                rightResult: compare.rightResult,
                score: compare.score,
              });
              addSystemMessage(`Comparison report exported:\n  Markdown: ${report.mdPath}\n  JSON: ${report.jsonPath}`);
              logger.log({ event: 'export_compare', mdPath: report.mdPath, jsonPath: report.jsonPath });
            } else {
              const report = await exportSession(config, messages, model, temperature, systemPrompt, stats);
              addSystemMessage(`Report exported:\n  Markdown: ${report.mdPath}\n  JSON: ${report.jsonPath}`);
              logger.log({ event: 'export', mdPath: report.mdPath, jsonPath: report.jsonPath });
            }
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
    scrollback.end();
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
        {replay?.view === 'picker' ? (
          <Box flexDirection="column" flexGrow={1}>
            <SessionPicker sessions={replay.sessions} selectedIndex={replay.selected} />
          </Box>
        ) : replay?.view === 'play' && replaySnapshot ? (
          <>
            <Box flexGrow={1} flexDirection="column">
              <Box paddingX={1}>
                <Text bold color="cyan">
                  Replay · {replay.fileName} · event {replay.cursor + 1}/{replay.events.length} ·{' '}
                  {formatReplaySpeed(replay.speed, replay.playing)} · ←/→ step · +/- speed · Space play/pause · Esc exit
                </Text>
              </Box>
              <ChatPanel
                messages={replaySnapshot.messages}
                partial=""
                reasoning=""
                generating={false}
                error={null}
              />
            </Box>
            {replaySnapshot.activities.length > 0 && (
              <Box flexGrow={1} flexDirection="column">
                <ToolPanel activities={replaySnapshot.activities} />
              </Box>
            )}
          </>
        ) : compare ? (
          <Box flexGrow={1} flexDirection="column">
            <Box paddingX={1}>
              <Text bold color="cyan">
                Compare · {compare.testCaseName} · {compare.leftModel} vs {compare.rightModel}
                {compare.running ? ' (Esc to cancel)' : compare.ratingMode ? ` · Rating ${compare.ratingSide === 'left' ? 'A' : 'B'} · ${compare.ratingDimension} · [1-5] rate · ←/→ dim · ↑/↓ side · Esc done` : ' · [r] rate · Esc close'}
              </Text>
            </Box>
            <ComparePanel
              leftModel={compare.leftModel}
              rightModel={compare.rightModel}
              leftResult={compare.leftResult}
              rightResult={compare.rightResult}
              running={compare.running}
              leftPartial={compare.leftPartial}
              rightPartial={compare.rightPartial}
              leftReasoning={compare.leftReasoning}
              rightReasoning={compare.rightReasoning}
              score={compare.score}
              ratingMode={compare.ratingMode}
              ratingSide={compare.ratingSide}
              ratingDimension={compare.ratingDimension}
            />
          </Box>
        ) : (
          <>
            <Box flexGrow={1} flexDirection="column">
              {bench ? (
                <BenchmarkPanel
                  testCaseName={bench.testCaseName}
                  models={bench.models}
                  results={bench.results}
                  running={bench.running}
                  currentModel={bench.currentModel}
                />
              ) : (
                <ChatPanel
                  messages={messages}
                  partial={partial}
                  reasoning={reasoning}
                  generating={generating}
                  error={error}
                  scrollLine={scrollback.scrollLine}
                  onMeasured={handleChatMeasured}
                  onWheel={handleWheel}
                  expandedReasoning={expandedReasoning}
                  onToggleReasoning={toggleReasoning}
                  chatBottomRow={termRows - 2}
                />
              )}
            </Box>
            {toolActivities.length > 0 && (
              <Box flexGrow={1} flexDirection="column">
                <ToolPanel
                  activities={toolActivities}
                  compact={toolCompact}
                  pendingIds={pendingBatch}
                  focusedId={focusedActivity}
                />
              </Box>
            )}
          </>
        )}
      </Box>
      <InputLine
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={generating || hasToolPrompt || connectionError || (bench?.running ?? false) || compare !== null || replay !== null}
        placeholder={
          connectionError
            ? 'Ollama unreachable — press Enter to retry'
            : compare?.running
              ? 'Comparison running — press Esc to cancel'
              : compare?.ratingMode
                ? '[1-5] rate · ←/→ dimension · ↑/↓ side · Enter next · Esc done'
                : compare
                  ? 'Press [r] to rate · Esc to close'
                  : replay?.view === 'picker'
                    ? '↑↓ select session · Enter load · Esc exit'
                    : replay?.view === 'play'
                      ? '←/→ step events · +/- speed · Space play/pause · PgUp/PgDn jump · Esc exit replay'
                      : bench?.running
                        ? 'Benchmark running — press Esc to cancel'
                        : focusedActivity
                          ? 'Press [a] approve, [d] deny this tool, [Esc] back to batch'
                          : pendingBatch.length > 1
                            ? `Press [a] approve all, [d] deny all, [1-${pendingBatch.length}] review one`
                            : pendingBatch.length === 1
                              ? 'Press [a] approve, [d] deny, or [t] cycle auto-approve'
                              : hasFailedTool
                                ? 'Press [f] fix, [s] skip, or [r] retry'
                                : generating
                                  ? 'Generating…'
                                  : maxScrollLine > 0
                                    ? 'Type a message · ↑/wheel to scroll · / for commands'
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
