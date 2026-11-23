import { useEffect, useState } from 'react';
import { Box, Text, useInput } from '@claude-code-kit/ink-renderer';
import { Spinner } from '@claude-code-kit/ui';
import { XakuLogo } from './XakuLogo.js';
import { colors } from './theme.js';
import { listInstalledModels, type InstalledModel } from '../model/ollama.js';

interface XakuMenuProps {
  baseUrl: string;
  currentModel: string;
  /** Launch directory, shown in the status panel so the user sees where tools will run. */
  workspace?: string;
  onModelSelect: (model: string) => void;
  onDismiss: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1d';
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

export function XakuMenu({ baseUrl, currentModel, workspace, onModelSelect, onDismiss }: XakuMenuProps) {
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  async function detectModels() {
    setLoading(true);
    try {
      const detected = await listInstalledModels(baseUrl);
      setModels(detected);
      setConnected(true);
      if (detected.length > 0) {
        const currentIndex = detected.findIndex((m) => m.name === currentModel);
        setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
      }
    } catch {
      setConnected(false);
      setModels([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void detectModels();
  }, []);

  function handleStart() {
    if (models.length > 0) {
      onModelSelect(models[selectedIndex].name);
    }
    onDismiss();
  }

  useInput((input, key) => {
    if (loading) return;
    if (models.length === 0) {
      if (input === 'r') void detectModels();
      if (key.escape) onDismiss();
      return;
    }

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < models.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return) {
      handleStart();
    } else if (input === 'r') {
      void detectModels();
    } else if (key.escape) {
      onDismiss();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column" flexGrow={1} alignItems="center" paddingTop={2}>
        <Box flexDirection="column" gap={1}>
          <XakuLogo />
          <Box marginTop={1}>
            <Text color={colors.success}>● Ollama connected · {baseUrl}</Text>
          </Box>
          <Box marginTop={1}>
            <Spinner label="Detecting models..." color={colors.accent} />
          </Box>
        </Box>
      </Box>
    );
  }

  const displayNameWidth = models.length > 0
    ? Math.max(...models.map((m) => m.name.length))
    : 10;

  return (
    <Box flexDirection="column" flexGrow={1} alignItems="center" paddingTop={2}>
      <Box flexDirection="column" gap={1}>
        <XakuLogo />
        
        <Box>
          {connected ? (
            <Text color={colors.success}>● Ollama connected · {baseUrl}</Text>
          ) : (
            <Text color={colors.error}>● Ollama disconnected · Start Ollama to begin</Text>
          )}
        </Box>

        {workspace && (
          <Box>
            <Text color={colors.dimText}>⌂ workspace </Text>
            <Text color={colors.accentBright}>{workspace}</Text>
          </Box>
        )}

        {!connected && models.length === 0 && (
          <Box marginTop={1}>
            <Text color={colors.dimText}>Press r to refresh</Text>
          </Box>
        )}

        {connected && models.length === 0 && (
          <Box flexDirection="column" gap={0} marginTop={1}>
            <Text color={colors.error}>No models found</Text>
            <Text color={colors.dimText}>Run: ollama pull {'<model>'}</Text>
            <Text color={colors.dimText}>Press r to refresh</Text>
          </Box>
        )}

        {models.length > 0 && (() => {
          const boxWidth = displayNameWidth + 35;
          const titleText = ' Models ';
          const titlePad = boxWidth - titleText.length - 2;
          
          return (
            <Box flexDirection="column" gap={0} marginTop={1}>
              <Text color={colors.accent}>
                ╭─{titleText}{'─'.repeat(titlePad)}╮
              </Text>
              {models.map((m, i) => {
                const isSelected = i === selectedIndex;
                const isLastUsed = m.name === currentModel;
                const name = m.name.padEnd(displayNameWidth);
                const lastUsedMarker = isLastUsed ? '✓ last used   ' : '               ';
                const size = formatSize(m.size).padStart(6);
                const age = formatAge(m.modifiedAt).padStart(3);
                
                return (
                  <Text key={m.name} color={isSelected ? colors.accentBright : 'white'}>
                    │ {isSelected ? '❯' : ' '} {name} {lastUsedMarker} {size}  {age} │
                  </Text>
                );
              })}
              <Text color={colors.accent}>
                ╰{'─'.repeat(boxWidth)}╯
              </Text>
            </Box>
          );
        })()}

        <Box marginTop={1}>
          <Text color={colors.dimText}>↑↓ choose   ⏎ start   r refresh   esc skip</Text>
        </Box>
      </Box>
    </Box>
  );
}
