import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type FeishuFetcherModule = {
  extractFeishuWorkflowSourcesFromHtml(html: string): Array<{
    recordId: string;
    token: string;
    mimeType: string;
    size: number;
    name: string;
  }>;
  extractFeishuRecordSeedsFromHtml(html: string): string[];
  extractFeishuTxtRecordSeedsFromAuditManifest(manifestText: string): string[];
  mergeFeishuWorkflowSources(...sourceLists: Array<Array<{
    recordId?: string;
    token: string;
    mimeType?: string;
    size?: number;
    name: string;
  }> | undefined>): Array<{
    recordId?: string;
    token: string;
    mimeType?: string;
    size?: number;
    name: string;
  }>;
  sanitizeWorkflowFilename(name: string, index: number, stablePrefix?: string): string;
};

async function importFeishuFetcher(): Promise<FeishuFetcherModule> {
  // @ts-expect-error The Feishu fetcher is an executable .mjs script with named exports.
  return import('../scripts/fetch-feishu-coze-workflows.mjs') as Promise<FeishuFetcherModule>;
}

describe('Feishu Coze workflow fetcher', () => {
  it('exposes an npm script for downloading Feishu workflow sources', async () => {
    const packageJson = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['fetch:coze:feishu']).toBe('node scripts/fetch-feishu-coze-workflows.mjs');
  });

  it('extracts downloadable txt workflow attachments from Feishu wiki html', async () => {
    const { extractFeishuWorkflowSourcesFromHtml, sanitizeWorkflowFilename } = await importFeishuFetcher();

    const html = String.raw`
      <script>
        window.__mock = {
          "ZipRecord":{"id":"ZipRecord","version":2,"data":{"type":"file","file":{"token":"zip-token","mimeType":"application/zip","size":100,"name":"素材包.zip"}}},
          "TxtRecord":{"id":"TxtRecord","version":2,"data":{"type":"file","file":{"token":"txt-token","mimeType":"text/plain","size":360583,"name":"【S1】炫酷书单1.txt","width":0,"height":0}}},
          "OtherRecord":{"id":"OtherRecord","version":2,"data":{"type":"heading2","text":{"initialAttributedTexts":[]}}}
        };
      </script>`;

    const sources = extractFeishuWorkflowSourcesFromHtml(html);

    expect(sources).toEqual([
      {
        recordId: 'TxtRecord',
        token: 'txt-token',
        mimeType: 'text/plain',
        size: 360583,
        name: '【S1】炫酷书单1.txt',
      },
    ]);
    expect(sanitizeWorkflowFilename('【S1】炫酷书单1.txt', 3)).toBe('003-【S1】炫酷书单1.txt');
    expect(sanitizeWorkflowFilename('工作流.txt', 3, 'RecordIdSeed12345')).toBe('RecordIdSeed12345-工作流.txt');
  });

  it('merges html and runtime workflow sources without duplicate records', async () => {
    const { mergeFeishuWorkflowSources } = await importFeishuFetcher();

    const sources = mergeFeishuWorkflowSources(
      [
        {
          recordId: 'TxtRecord',
          token: 'txt-token-from-html',
          mimeType: 'text/plain',
          size: 360583,
          name: '【S1】炫酷书单1.txt',
        },
      ],
      [
        {
          recordId: 'TxtRecord',
          token: 'txt-token-from-runtime',
          mimeType: 'text/plain',
          size: 360583,
          name: '【S1】炫酷书单1.txt',
        },
        {
          recordId: 'LaterRecord',
          token: 'later-token',
          mimeType: 'text/plain',
          size: 112394,
          name: '【S66】每日感悟.txt',
        },
      ],
    );

    expect(sources).toEqual([
      {
        recordId: 'TxtRecord',
        token: 'txt-token-from-html',
        mimeType: 'text/plain',
        size: 360583,
        name: '【S1】炫酷书单1.txt',
      },
      {
        recordId: 'LaterRecord',
        token: 'later-token',
        mimeType: 'text/plain',
        size: 112394,
        name: '【S66】每日感悟.txt',
      },
    ]);
  });

  it('extracts txt record ids from a saved Feishu attachment audit manifest', async () => {
    const { extractFeishuTxtRecordSeedsFromAuditManifest } = await importFeishuFetcher();

    const manifest = {
      attachments: [
        {
          type: 'zip',
          recordId: 'ZipRecord',
          name: '素材.zip',
        },
        {
          type: 'txt',
          recordId: 'TxtRecord',
          name: '工作流.txt',
        },
        {
          type: 'txt',
          recordId: 'MojibakeRecord',
          name: '工作流?txt',
        },
        {
          type: 'txt',
          recordId: 'TxtRecord',
          name: '工作流.txt',
        },
      ],
    };

    expect(extractFeishuTxtRecordSeedsFromAuditManifest(JSON.stringify(manifest))).toEqual(['TxtRecord', 'MojibakeRecord']);
  });

  it('extracts candidate record seeds from Feishu document html maps and children lists', async () => {
    const { extractFeishuRecordSeedsFromHtml } = await importFeishuFetcher();

    const html = `
      <script>
        window.__doc = {
          "GridRecordLong01":{"id":"GridRecordLong01","version":1,"data":{"type":"grid","children":["TxtFileRecordLong1","TextRecordLong001"]}},
          "TxtFileRecordLong1":{"id":"TxtFileRecordLong1","version":2,"data":{"type":"file"}},
          "TextRecordLong001":{"id":"TextRecordLong001","version":1,"data":{"type":"text"}}
        };
      </script>
    `;

    expect(extractFeishuRecordSeedsFromHtml(html)).toEqual(['GridRecordLong01', 'TxtFileRecordLong1', 'TextRecordLong001']);
  });
});
