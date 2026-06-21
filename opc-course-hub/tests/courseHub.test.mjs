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
