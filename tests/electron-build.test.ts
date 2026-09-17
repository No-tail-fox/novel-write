import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('electron build', () => {
  it('keeps native runtime modules external while bundling the IPC schema runtime', async () => {
    const script = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };

    expect(script).toMatch(/external:\s*\[[^\]]*['"]electron['"][^\]]*['"]sql\.js['"][^\]]*['"]undici['"][^\]]*\]/s);
    expect(script).toContain("import { createRequire as __storydreamCreateRequire } from 'node:module'");
    expect(script).toContain('const require = __storydreamCreateRequire(import.meta.url)');
    expect(script).toContain("'node_modules/gsap/dist/gsap.min.js'");
    expect(script).toContain("'dist-electron/electron/gsap.min.js'");
    expect(packageJson.dependencies).toMatchObject({
      '@fluentui/react-components': '^9.74.5',
      '@modelcontextprotocol/sdk': '1.30.0',
      'agent-search-mcp': '3.2.1',
      'sql.js': expect.any(String),
      undici: '^6.27.0',
      zod: '^4.4.3',
    });
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      '@fluentui/react-components',
      '@modelcontextprotocol/sdk',
      'agent-search-mcp',
      'sql.js',
      'undici',
      'zod',
    ]);
    expect(packageJson.devDependencies).toMatchObject({
      concurrently: '^9.2.1',
      esbuild: '^0.28.1',
      gsap: '3.12.5',
      vite: '^8.1.4',
    });
    expect(packageJson.overrides).toMatchObject({ 'shell-quote': '1.9.0' });
  });

  it('bundles the fixed Agent Search MCP server and its license into Electron output', async () => {
    const script = await readFile(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');

    expect(script).toContain("entryPoints: ['node_modules/agent-search-mcp/dist/index.js']");
    expect(script).toContain("outfile: 'dist-electron/electron/agent-search-mcp-server.cjs'");
    expect(script).toContain("format: 'cjs'");
    expect(script).toContain("'import.meta.url': '__storydreamAgentSearchModuleUrl'");
    expect(script).toContain('agentSearchVersionPlugin');
    expect(script).toContain('writeAgentSearchThirdPartyNotices(agentSearchBuild.metafile.inputs)');
    expect(script).toContain("copyFile('node_modules/agent-search-mcp/LICENSE', 'dist-electron/electron/AGENT_SEARCH_LICENSE.txt')");
    expect(script).toContain("'dist-electron/electron/AGENT_SEARCH_THIRD_PARTY_NOTICES.txt'");
  });

  it('keeps the smoke command on the npm-provided Node runtime', async () => {
    const script = await readFile(new URL('../scripts/smoke-electron.ps1', import.meta.url), 'utf8');
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { main?: string; scripts?: Record<string, string> };

    expect(manifest.main).toBe('dist-electron/electron/main.js');
    expect(manifest.scripts?.['smoke:electron']).toContain('smoke-electron.ps1');
    expect(script).toContain('run-npm-node.cmd');
  });
});
