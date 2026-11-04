// Choose once before opening a session; both entries point to the same host.
export async function chooseReachableService(bases: string[], check: (base: string) => Promise<boolean>): Promise<string | null> {
  if (!bases.length) return null;
  try {
    return await Promise.any(bases.map(async base => {
      if (!await check(base)) throw new Error('unavailable');
      return base;
    }));
  } catch { return bases[0]; }
}
