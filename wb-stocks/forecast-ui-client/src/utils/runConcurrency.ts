/** Выполняет async задачи с ограничением параллелизма (простая очередь). */
export async function runConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const cap = Math.max(1, Math.min(concurrency, n));
  const results: R[] = new Array(n);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const idx = nextIndex++;
      if (idx >= n) return;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}
