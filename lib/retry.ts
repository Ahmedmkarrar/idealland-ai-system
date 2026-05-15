const RETRY_DELAY_MS = [500, 1500, 4500] as const;

export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY_MS[attempt] ?? 4500)
        );
      }
    }
  }
  throw lastError;
}
