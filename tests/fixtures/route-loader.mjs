import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Only the platform binding and extensionless local TypeScript imports differ in Node.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return { url: 'mock-cloudflare:workers', shortCircuit: true };
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mock-cloudflare:workers') return { format: 'module', source: 'export const env = globalThis.__routeTestEnv;', shortCircuit: true };
    return nextLoad(url, context);
  },
});
