import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/shared/config';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { isProviderPortalUrl, providerKeyPortals, providerPortalForApi, PROVIDER_KEY_PORTALS } from '../src/shared/provider-portals';
import { buildConfigForSelectedProfileTest } from '../src/shared/provider-profile-utils';

describe('provider credential portal selection', () => {
  it.each([
    ['https://api.openai.com/v1', 'openai'],
    ['https://api.anthropic.com', 'anthropic'],
    ['https://api.minimaxi.com/v1', 'minimax'],
    ['https://api.siliconflow.cn/v1', 'siliconflow'],
    ['https://openspeech.bytedance.com/api/v3/tts/unidirectional', 'volcSpeech'],
    ['https://visual.volcengineapi.com', 'volcAccess'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'volcArk'],
  ] as const)('resolves %s to its actual credential console', (url, portal) => {
    expect(providerPortalForApi(url)).toEqual([PROVIDER_KEY_PORTALS[portal]]);
  });

  it('keeps a custom relay neutral regardless of selected protocol or model name', () => {
    const llm = { ...defaultConfig.llm, provider: 'custom', protocol: 'anthropic' as const, baseUrl: 'https://relay.example/v1?key=dummy#token', model: 'claude-test' };
    expect(providerKeyPortals('llm', { ...defaultConfig, llm })).toEqual([{ label: '服务商网站', url: 'https://relay.example/' }]);
    expect(providerPortalForApi('https://api.openai.com.evil.example/v1')).toEqual([{ label: '服务商网站', url: 'https://api.openai.com.evil.example/' }]);
    expect(providerPortalForApi('https://moeapi.cloud/v1?api_key=dummy')).toEqual([{ label: '服务商网站', url: 'https://moeapi.cloud/' }]);
  });

  it('distinguishes speech API credentials, legacy apps, and account Access Keys', () => {
    const config = structuredClone(defaultConfig);
    config.tts.provider = 'volcengine';
    config.tts.volcengine.apiVersion = 'v3';
    expect(providerKeyPortals('tts', config)).toEqual([PROVIDER_KEY_PORTALS.volcSpeech, PROVIDER_KEY_PORTALS.volcAccess]);
    config.tts.volcengine.apiVersion = 'legacy';
    expect(providerKeyPortals('tts', config)).toEqual([PROVIDER_KEY_PORTALS.volcSpeech]);
    config.tts.provider = 'minimax';
    expect(providerKeyPortals('tts', config)).toEqual([PROVIDER_KEY_PORTALS.minimax]);
  });

  it('uses the selected profile instead of the currently active profile', () => {
    const config = structuredClone(defaultConfig);
    config.llmProfiles.push({ ...config.llm, id: 'other', provider: 'openai', baseUrl: 'https://api.openai.com' });
    const selected = buildConfigForSelectedProfileTest(config, 'llm', { llm: 'other' });
    expect(providerKeyPortals('llm', selected)).toEqual([PROVIDER_KEY_PORTALS.openai]);
    expect(config.activeLlmProfileId).not.toBe('other');
    config.ttsProfiles.push({ ...config.tts, id: 'other-tts', name: 'MiniMax QA', enabled: false, provider: 'minimax' });
    expect(providerKeyPortals('tts', buildConfigForSelectedProfileTest(config, 'tts', { tts: 'other-tts' }))).toEqual([PROVIDER_KEY_PORTALS.minimax]);
  });

  it('handles image and STT defaults while leaving an empty custom provider unlinked', () => {
    const config = structuredClone(defaultConfig);
    config.llm = { ...config.llm, provider: 'openai', baseUrl: '' };
    expect(providerKeyPortals('llm', config)).toEqual([PROVIDER_KEY_PORTALS.openai]);
    config.llm.provider = 'anthropic';
    expect(providerKeyPortals('llm', config)).toEqual([PROVIDER_KEY_PORTALS.anthropic]);
    config.llm.provider = 'custom';
    expect(providerKeyPortals('llm', config)).toEqual([]);
    config.imageProvider = 'gpt_image';
    expect(providerKeyPortals('image', config)).toEqual([PROVIDER_KEY_PORTALS.openai]);
    config.imageProvider = 'jimeng';
    expect(providerKeyPortals('image', config)).toEqual([PROVIDER_KEY_PORTALS.volcAccess]);
    config.imageProvider = 'custom';
    expect(providerKeyPortals('image', config)).toEqual([]);
    config.speechToText = { ...config.speechToText, provider: 'siliconflow', baseUrl: '' };
    expect(providerKeyPortals('speechToText', config)).toEqual([PROVIDER_KEY_PORTALS.siliconflow]);
  });

  it('uses the selected video service host and never leaks request paths or query strings', () => {
    const config = structuredClone(defaultConfig);
    expect(providerKeyPortals('video', config)).toEqual([]);
    config.video.providers.push({ ...config.video.providers[0], id: 'second', baseUrl: 'https://video.example/tenant/api/v1?secret=hidden#private' });
    config.video.activeProviderId = 'second';
    expect(providerKeyPortals('video', config)).toEqual([{ label: '服务商网站', url: 'https://video.example/' }]);
  });
});

describe('provider portal navigation boundary', () => {
  it.each(Object.values(PROVIDER_KEY_PORTALS))('accepts the verified console $label', (portal) => {
    expect(isProviderPortalUrl(portal.url)).toBe(true);
    expect(ipcInputSchemas['provider:open-portal'].parse(portal.url)).toBe(portal.url);
  });

  it.each(['', 'not a url', 'javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test', 'http://public.example/', 'https://user:pass@public.example/', 'https://localhost/', 'https://example.local/', 'https://example.internal/', 'https://example.localhost/', 'https://127.0.0.1/', 'https://2130706433/', 'https://[::1]/', 'https://public.example:8080/'])('omits unsafe or local endpoint %s', (url) => {
    expect(providerPortalForApi(url)).toEqual([]);
    expect(() => ipcInputSchemas['provider:open-portal'].parse(url)).toThrow();
  });

  it.each(['https://video.example/path', 'https://video.example/?api_key=secret', 'https://video.example/#secret', 'https://platform.openai.com/api-keys?leak=secret'])('rejects non-allowlisted path or parameters: %s', (url) => {
    expect(isProviderPortalUrl(url)).toBe(false);
    expect(() => ipcInputSchemas['provider:open-portal'].parse(url)).toThrow();
  });

  it('accepts a public custom service origin', () => {
    expect(ipcInputSchemas['provider:open-portal'].parse('https://video.example/')).toBe('https://video.example/');
  });

  it('routes external navigation through trusted main and does not save the settings draft', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const links = await readFile(new URL('../src/features/settings/ProviderPortalLinks.tsx', import.meta.url), 'utf8');
    const settings = await readFile(new URL('../src/features/settings/SettingsPage.tsx', import.meta.url), 'utf8');
    const browser = await readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8');
    const start = main.indexOf("trustedHandle('provider:open-portal'");
    expect(start).toBeGreaterThan(-1);
    expect(main.slice(start, main.indexOf('\ntrustedHandle(', start + 1))).toContain("assertNetworkUrl(url, 'public-research')");
    expect(main.slice(start, main.indexOf('\ntrustedHandle(', start + 1))).toContain('await shell.openExternal(target.href)');
    expect(preload).toContain("invokeTrusted('provider:open-portal', url)");
    expect(links).toContain('action.run(() => onOpen(link.url))');
    expect(links).toContain('<AsyncActionFeedback');
    expect(links).not.toContain('saveConfig');
    expect(links).not.toContain('apiKey');
    for (const target of ['llm', 'image', 'video', 'tts', 'speechToText']) expect(settings).toContain(`providerKeyPortals('${target}',`);
    const handler = browser.slice(browser.indexOf('async openProviderPortal'), browser.indexOf('async savePromptTemplate'));
    expect(handler).toContain('isProviderPortalUrl(url)');
    expect(handler).toContain("window.open(url, '_blank', 'noopener,noreferrer')");
  });
});
