import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoutePlan,
  defaultCourses,
  defaultResources,
  defaultWechatTemplates,
  filterCourses,
  filterResources,
  generateWechatCopy,
  getDashboardStats,
  validateCourse,
} from '../assets/app-data.mjs';

const appData = await import('../assets/app-data.mjs');

test('site navigation separates homepage, content pages, workbench, publisher, and admin', () => {
  assert.ok(Array.isArray(appData.siteNavItems));

  const routeIds = appData.siteNavItems.map((item) => item.id);

  assert.deepEqual(routeIds, ['home', 'courses', 'resources', 'route', 'local', 'workbench', 'wechat', 'admin']);
  assert.deepEqual(
    appData.siteNavItems.map((item) => item.label),
    ['首页', '课程库', 'AI资源', '学习路线', 'OPC课程', '应用工作台', '公众号', '后台'],
  );
  assert.ok(appData.homeHighlights.every((item) => routeIds.includes(item.route)));
});

test('workbench mode data supports current model trial categories', () => {
  assert.ok(Array.isArray(appData.workbenchModes));

  const labels = appData.workbenchModes.map((mode) => mode.label);

  assert.deepEqual(labels, ['文本', '语音', '视频', '图像', '音乐']);
  for (const mode of appData.workbenchModes) {
    assert.ok(mode.placeholder.includes('输入') || mode.placeholder.includes('描述'));
    assert.ok(mode.sampleAction.length > 0);
  }

  assert.ok(appData.defaultWorkbenchThreads.length >= 4);
  assert.ok(appData.defaultWorkbenchThreads.some((thread) => thread.pinned));
});

test('workbench landing data matches the referenced assistant shell', () => {
  assert.deepEqual(
    appData.workbenchSidebarActions.map((item) => item.label),
    ['新对话', '新办公任务', 'AI 创作', '云盘', '更多'],
  );
  assert.deepEqual(
    appData.workbenchToolActions.map((item) => item.label),
    ['快速', 'PPT 生成', '图像生成', '帮我写作', '编程', '视频生成', '更多'],
  );
  assert.equal(appData.workbenchQuickPrompts.length, 9);
  assert.ok(appData.workbenchQuickPrompts.includes('有什么我能帮你的吗？') === false);
  assert.ok(appData.workbenchQuickPrompts.some((item) => item.includes('联合体投标流程')));
  assert.equal(appData.defaultWorkbenchThreads[0].title, '新对话');
  assert.deepEqual(appData.defaultWorkbenchThreads[0].messages, []);
});

test('feishu knowledge items supplement the resource and workbench content', () => {
  assert.ok(Array.isArray(appData.feishuKnowledgeItems));
  assert.ok(appData.feishuKnowledgeItems.length >= 8);

  const titles = appData.feishuKnowledgeItems.map((item) => item.title);

  assert.ok(titles.includes('Seedance2.0做动漫修仙视频'));
  assert.ok(titles.includes('电商主图二创'));
  assert.ok(titles.includes('【S86】小说推文'));
  for (const item of appData.feishuKnowledgeItems) {
    assert.ok(item.summary.length >= 12);
    assert.match(item.rightsNote, /飞书知识库|内部资料|导览|摘要/);
  }
});

test('route normalization falls back to home for unknown hashes', () => {
  assert.equal(appData.normalizeRouteId(''), 'home');
  assert.equal(appData.normalizeRouteId('#/courses'), 'courses');
  assert.equal(appData.normalizeRouteId('#workbench'), 'workbench');
  assert.equal(appData.normalizeRouteId('not-a-route'), 'home');
});

test('workbench replies stay deterministic and mode aware', () => {
  const reply = appData.buildWorkbenchReply('image', '帮我写一个电商主图提示词', {
    title: '电商主图提示词',
    messages: [{ role: 'user', content: '帮我写一个电商主图提示词' }],
  }, {
    courses: defaultCourses,
    resources: defaultResources,
    feishuKnowledgeItems: appData.feishuKnowledgeItems,
  });

  assert.match(reply, /图像|主图|提示词/);
  assert.match(reply, /OPC|电商/);
});

test('course seed data keeps copyright-safe guide fields', () => {
  assert.ok(defaultCourses.length >= 6);
  for (const course of defaultCourses) {
    assert.equal(validateCourse(course).valid, true, course.title);
    assert.ok(course.officialUrl.startsWith('https://'));
    assert.match(course.rightsNote, /导览|官方|不搬运|公开/);
  }
});

test('filters course library by keyword, category, price type, and track', () => {
  const result = filterCourses(defaultCourses, {
    keyword: '漫剧',
    category: 'AI漫剧',
    priceType: 'free',
    track: '作品实操',
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'OPC AI漫剧创作实践营');
});

test('resources include WaytoAGI as a navigation resource instead of a course', () => {
  const courseHit = filterCourses(defaultCourses, { keyword: 'WaytoAGI' });
  const resourceHit = filterResources(defaultResources, { keyword: 'WaytoAGI', category: '知识库' });

  assert.equal(courseHit.length, 0);
  assert.equal(resourceHit.length, 1);
  assert.equal(resourceHit[0].type, 'AI资源导航');
});

test('wechat copy generation includes disclaimer and selected items', () => {
  const courses = filterCourses(defaultCourses, { category: 'AI电商' }).slice(0, 2);
  const resources = filterResources(defaultResources, { category: '工具导航' }).slice(0, 1);
  const copy = generateWechatCopy(defaultWechatTemplates[0], courses, resources);

  assert.match(copy, /OPC社区/);
  assert.match(copy, /不承诺收益/);
  assert.match(copy, new RegExp(courses[0].title));
  assert.match(copy, new RegExp(resources[0].name));
});

test('dashboard stats and route plan summarize learning hub coverage', () => {
  const stats = getDashboardStats(defaultCourses, defaultResources);
  const routePlan = buildRoutePlan(defaultCourses);

  assert.ok(stats.freeCourses >= 4);
  assert.ok(stats.resources >= 4);
  assert.ok(routePlan.some((stage) => stage.title === '入门识图'));
  assert.ok(routePlan.some((stage) => stage.courses.length > 0));
});
