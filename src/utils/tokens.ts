/**
 * Rough token count estimation.
 * Uses the ~4 chars per token heuristic which is a good approximation
 * for most LLM tokenizers.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token limit, keeping the beginning.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n<!-- Truncated to fit token limit -->";
}
