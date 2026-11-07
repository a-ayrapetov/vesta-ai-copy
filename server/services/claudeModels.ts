/**
 * Claude models the chat tries, in order.
 * Defaults verified 2026-11-07 against the Anthropic model deprecations page
 * (https://platform.claude.com/docs/en/about-claude/model-deprecations): the old
 * claude-3-* IDs this app used are retired, so every call failed and chat fell back
 * to rule-based answers. Set ANTHROPIC_MODEL to pin or try a different model first.
 */
export const DEFAULT_CLAUDE_MODELS: readonly string[] = [
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
];

export function getClaudeModels(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const override = env.ANTHROPIC_MODEL?.trim();
  if (!override) return [...DEFAULT_CLAUDE_MODELS];
  return [override, ...DEFAULT_CLAUDE_MODELS.filter((m) => m !== override)];
}
