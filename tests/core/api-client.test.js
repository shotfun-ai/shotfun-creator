// 覆盖 OpenAPI 客户端的响应解包、状态提取、URL/Asset 提取和重试边界。
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ShotFunOpenApiClient,
  extractAssetRefs,
  extractGroupId,
  extractResultUrls,
  extractStatus,
  extractTaskNo,
} from '../../scripts/core/api-client.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SHOTFUN_API_KEY;
const originalBaseUrl = process.env.SHOTFUN_BASE_URL;

describe('ShotFunOpenApiClient', () => {
  beforeEach(() => {
    process.env.SHOTFUN_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('SHOTFUN_API_KEY', originalApiKey);
    restoreEnv('SHOTFUN_BASE_URL', originalBaseUrl);
  });

  it('creates ShotFun tasks with X-Api-Key and OpenAPI V1 payload', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        code: 200,
        msg: '操作成功',
        data: {
          taskNo: 'task-001',
          status: 'pending',
        },
      });
    };

    const client = new ShotFunOpenApiClient({ apiKey: 'sf_test' });
    const result = await client.createTask({
      projectCode: 'demo-project',
      taskCode: 'sd_reference',
      inputParams: { prompt: 'hello', imageUrls: [] },
    });

    assert.equal(calls[0].url, 'https://open.shotfun.cn/open-api/v1/task/create');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['X-Api-Key'], 'sf_test');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      projectCode: 'demo-project',
      taskCode: 'sd_reference',
      inputParams: { prompt: 'hello', imageUrls: [] },
    });
    assert.equal(result.taskNo, 'task-001');
  });

  it('queries and unwraps R responses', async () => {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://open.shotfun.cn/open-api/v1/task/query/task-001');
      assert.equal(init.method, 'GET');
      return jsonResponse({
        code: 200,
        msg: '操作成功',
        data: {
          taskNo: 'task-001',
          status: 'success',
          resultData: { imageUrl: 'https://cdn.example.com/a.png' },
        },
      });
    };

    const client = new ShotFunOpenApiClient({ apiKey: 'sf_test' });
    const result = await client.queryTask('task-001');

    assert.equal(result.taskNo, 'task-001');
    assert.equal(result.status, 'success');
    assert.deepEqual(extractResultUrls(result), ['https://cdn.example.com/a.png']);
  });

  it('ignores SHOTFUN_BASE_URL because the OpenAPI domain is fixed', async () => {
    process.env.SHOTFUN_BASE_URL = 'https://override.example.com';
    globalThis.fetch = async (url) => {
      assert.equal(url, 'https://open.shotfun.cn/open-api/v1/task/query/task-001');
      return jsonResponse({
        code: 200,
        msg: '操作成功',
        data: { taskNo: 'task-001', status: 'success' },
      });
    };

    const client = new ShotFunOpenApiClient({ apiKey: 'sf_test' });
    await client.queryTask('task-001');
  });

  it('creates a task and waits for the final result with one API method', async () => {
    const urls = [];
    globalThis.fetch = async (url, init) => {
      urls.push(url);
      if (url.endsWith('/open-api/v1/task/create')) {
        assert.equal(init.method, 'POST');
        return jsonResponse({
          code: 200,
          msg: '操作成功',
          data: {
            taskNo: 'task-001',
            status: 'pending',
          },
        });
      }
      if (url.endsWith('/open-api/v1/task/query/task-001')) {
        assert.equal(init.method, 'GET');
        return jsonResponse({
          code: 200,
          msg: '操作成功',
          data: {
            taskNo: 'task-001',
            status: 'success',
            resultData: { resultUrl: 'https://cdn.example.com/result.mp4' },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new ShotFunOpenApiClient({ apiKey: 'sf_test', pollIntervalMs: 1 });
    const result = await client.createTaskAndWait({
      projectCode: 'demo-project',
      taskCode: 'sd_reference',
      inputParams: { prompt: 'hello' },
    });

    assert.deepEqual(urls, [
      'https://open.shotfun.cn/open-api/v1/task/create',
      'https://open.shotfun.cn/open-api/v1/task/query/task-001',
    ]);
    assert.equal(result.taskNo, 'task-001');
    assert.equal(result.status, 'success');
    assert.deepEqual(extractResultUrls(result), ['https://cdn.example.com/result.mp4']);
  });

  it('uploads files using multipart form with optional path', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        code: 200,
        msg: '操作成功',
        data: {
          fileId: 'file_001',
          url: 'https://cdn.example.com/file.png',
        },
      });
    };

    const client = new ShotFunOpenApiClient({ apiKey: 'sf_test' });
    const result = await client.uploadFile(new URL('./api-client.test.js', import.meta.url), { path: 'tests' });

    assert.equal(calls[0].url, 'https://open.shotfun.cn/open-api/v1/file/upload');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['X-Api-Key'], 'sf_test');
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.body.get('path'), 'tests');
    assert.equal(result.fileId, 'file_001');
  });

  it('extracts task numbers and statuses from ShotFun task payloads', () => {
    assert.equal(extractTaskNo({ taskNo: 'task-001' }), 'task-001');
    assert.equal(extractTaskNo({ data: { taskNo: 'task-002' } }), 'task-002');
    assert.equal(extractStatus({ data: { status: 'SUCCESS' } }), 'success');
  });

  it('extracts asset refs and group IDs from nested payloads', () => {
    const payload = {
      data: {
        resultData: {
          groupId: '42',
          assets: [{ ref: 'Asset://asset-001' }, { id: 'asset-002' }],
        },
      },
    };

    assert.equal(extractGroupId(payload), 42);
    assert.deepEqual(extractAssetRefs(payload), ['Asset://asset-001', 'Asset://asset-002']);
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
