import { Box, Text } from 'ink';
import { theme, getSymbols } from './theme.js';
import {
  DIMENSION_LABELS,
  DIMENSIONS,
  type CompareSideResult,
  type CompareToolActivity,
  type ComparisonScore,
  type Dimension,
  type ModelRatings,
} from '../model/compare.js';

export interface ComparePanelProps {
  leftModel: string;
  rightModel: string;
  leftResult: CompareSideResult;
  rightResult: CompareSideResult;
  running: boolean;
  leftPartial?: string;
  rightPartial?: string;
  leftReasoning?: string;
  rightReasoning?: string;
  score?: ComparisonScore;
  ratingMode?: boolean;
  ratingSide?: 'left' | 'right';
  ratingDimension?: Dimension;
}

function SidePane({
  side,
  model,
  result,
  running,
  partial,
  reasoning,
  focused,
}: {
  side: 'left' | 'right';
  model: string;
  result: CompareSideResult;
  running: boolean;
  partial?: string;
  reasoning?: string;
  focused: boolean;
}) {
  const symbols = getSymbols();
  const borderColor = focused ? theme.primary : theme.muted;
  const displayText = result.responseText || partial || '';
  const lines = displayText.split('\n').slice(-20);

  return (
    <Box flexDirection="column" width="50%" paddingX={1} borderStyle="single" borderColor={borderColor}>
      <Box flexDirection="column">
        <Box>
          <Text bold color={theme.primary}>{side === 'left' ? 'A' : 'B'}. {model}</Text>
        </Box>
        <Box>
          {running ? (
            <Text color={theme.muted}>{symbols.spinner[0]} generating · {result.tokensPerSecond.toFixed(1)} tok/s</Text>
          ) : result.status === 'error' ? (
            <Text color={theme.failure}>{symbols.failure} {result.error ?? 'failed'}</Text>
          ) : (
            <Text color={theme.success}>
              {symbols.success} {(result.totalTimeMs / 1000).toFixed(1)}s · {result.tokensPerSecond.toFixed(1)} tok/s
            </Text>
          )}
        </Box>
        {result.toolCalls > 0 && (
          <Text color={theme.muted}>
            Tools: {result.toolSuccess}/{result.toolCalls} ok
          </Text>
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {reasoning && reasoning.length > 0 && (
          <Text color={theme.muted} dimColor italic>
            {reasoning.length > 100 ? reasoning.slice(0, 100) + '…' : reasoning}
          </Text>
        )}
        {lines.map((line, i) => (
          <Text key={i}>{line || ' '}</Text>
        ))}
        {running && displayText.length > 0 && <Text>{symbols.cursor}</Text>}
      </Box>
      {result.toolActivities.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted} dimColor>Tool activity:</Text>
          {result.toolActivities.slice(-5).map((a) => (
            <Text key={a.id} color={a.status === 'success' ? theme.success : a.status === 'failed' ? theme.failure : theme.muted}>
              {a.status === 'running' ? symbols.spinner[0] : a.status === 'success' ? symbols.success : symbols.failure} {a.toolName} {a.durationMs > 0 ? `${(a.durationMs / 1000).toFixed(1)}s` : ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function RatingBar({ ratings, activeDimension }: { ratings: ModelRatings; activeDimension: Dimension }) {
  return (
    <Box flexDirection="column">
      {DIMENSIONS.map((dim) => {
        const val = ratings[dim];
        const isActive = dim === activeDimension;
        const label = DIMENSION_LABELS[dim];
        return (
          <Box key={dim}>
            <Text color={isActive ? theme.primary : theme.muted}>
              {isActive ? '▸ ' : '  '}{label}: {val !== null ? '★'.repeat(val) + '☆'.repeat(5 - val) : '—/5'}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function ScoreTable({ score }: { score: ComparisonScore }) {
  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Text bold color={theme.primary}>Ratings</Text>
      <Box>
        <Box width="40%"><Text color={theme.muted}>Dimension</Text></Box>
        <Box width="25%"><Text color={theme.primary}>Model A</Text></Box>
        <Box width="25%"><Text color={theme.primary}>Model B</Text></Box>
      </Box>
      <Text color={theme.muted}>{'─'.repeat(30)}</Text>
      {DIMENSIONS.map((dim) => {
        const l = score.left.ratings[dim];
        const r = score.right.ratings[dim];
        return (
          <Box key={dim}>
            <Box width="40%"><Text>{DIMENSION_LABELS[dim]}</Text></Box>
            <Box width="25%">
              <Text color={l !== null ? theme.success : theme.muted}>{l !== null ? '★'.repeat(l) + '☆'.repeat(5 - l) : '—/5'}</Text>
            </Box>
            <Box width="25%">
              <Text color={r !== null ? theme.success : theme.muted}>{r !== null ? '★'.repeat(r) + '☆'.repeat(5 - r) : '—/5'}</Text>
            </Box>
          </Box>
        );
      })}
      {score.notes && (
        <Box marginTop={1}>
          <Text color={theme.muted}>Notes: {score.notes}</Text>
        </Box>
      )}
    </Box>
  );
}

export function ComparePanel({
  leftModel,
  rightModel,
  leftResult,
  rightResult,
  running,
  leftPartial,
  rightPartial,
  leftReasoning,
  rightReasoning,
  score,
  ratingMode = false,
  ratingSide = 'left',
  ratingDimension = 'accuracy',
}: ComparePanelProps) {
  if (running) {
    return (
      <Box flexDirection="row" flexGrow={1}>
        <SidePane side="left" model={leftModel} result={leftResult} running focused={false} partial={leftPartial} reasoning={leftReasoning} />
        <SidePane side="right" model={rightModel} result={rightResult} running focused={false} partial={rightPartial} reasoning={rightReasoning} />
      </Box>
    );
  }

  if (ratingMode) {
    const activeSide = ratingSide === 'left' ? score?.left : score?.right;
    return (
      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" width="50%" paddingX={1}>
          <SidePane side="left" model={leftModel} result={leftResult} running={false} focused={ratingSide === 'left'} />
          {score && <RatingBar ratings={score.left.ratings} activeDimension={ratingDimension} />}
        </Box>
        <Box flexDirection="column" width="50%" paddingX={1}>
          <SidePane side="right" model={rightModel} result={rightResult} running={false} focused={ratingSide === 'right'} />
          {score && <RatingBar ratings={score.right.ratings} activeDimension={ratingDimension} />}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        <SidePane side="left" model={leftModel} result={leftResult} running={false} focused={false} />
        <SidePane side="right" model={rightModel} result={rightResult} running={false} focused={false} />
      </Box>
      {score && <ScoreTable score={score} />}
      {!score && (
        <Box paddingX={1} marginTop={1}>
          <Text color={theme.primary}>Press [r] to rate · [Esc] to close</Text>
        </Box>
      )}
    </Box>
  );
}
