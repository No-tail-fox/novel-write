import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBaiPiaoCharity } from '../src/catalog.mjs';

test('parses BaiPiao cards as discovery entries without treating links as API endpoints', () => {
  const html = `
    <div data-card data-entry-id="demo" data-status="online">
      <a class="cname" href="/charity/demo/">Demo API</a>
      <p class="csum">注册送额度</p>
      <a class="centry" href="https://example.com/register?aff=x">注册入口</a>
    </div>
    <div data-card data-entry-id="second">
      <a class="cname" href="/charity/second/">Second</a>
      <p class="csum">另一个入口</p>
      <a class="centry" href="https://second.example/v1">站点</a>
    </div>`;
  const result = parseBaiPiaoCharity(html);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'baipiao:demo');
  assert.equal(result[0].name, 'Demo API');
  assert.equal(result[0].links[0].url, 'https://example.com/register?aff=x');
  assert.equal(result[0].callable, false);
});
