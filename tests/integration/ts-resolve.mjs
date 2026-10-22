// The plugin's relative imports have no extension: try .ts (sources, run with Node's type stripping) and .js (tsc output).
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (error) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
    for (const ext of ['.ts', '.js']) { try { return await next(`${specifier}${ext}`, context); } catch { /* next */ } }
    throw error;
  }
}
