import {
  buildRoutePlan,
  buildWorkbenchReply,
  courseCategories,
  defaultCourses,
  defaultResources,
  defaultWechatTemplates,
  defaultWorkbenchThreads,
  feishuKnowledgeItems,
  filterCourses,
  filterResources,
  generateWechatCopy,
  getDashboardStats,
  homeHighlights,
  loadStoredList,
  normalizeRouteId,
  resourceCategories,
  saveStoredList,
  siteNavItems,
  workbenchModes,
  workbenchQuickPrompts,
  workbenchSidebarActions,
  workbenchToolActions,
} from './app-data.mjs';

const COURSE_KEY = 'opc-course-hub:courses';
const RESOURCE_KEY = 'opc-course-hub:resources';
const THREAD_KEY = 'opc-course-hub:threads';
const ACTIVE_THREAD_KEY = 'opc-course-hub:active-thread';
const ACTIVE_MODE_KEY = 'opc-course-hub:active-mode';
const DEFAULT_WORKBENCH_THREAD_ID = 'thread-new-chat';
const WORKBENCH_SESSION_KEY = 'opc-course-hub:workbench-started';

const app = document.querySelector('#app');
const mainNav = document.querySelector('#mainNav');

const clone = (value) => JSON.parse(JSON.stringify(value));
let courses = clone(loadStoredList(COURSE_KEY, defaultCourses));
let resources = clone(loadStoredList(RESOURCE_KEY, defaultResources));
let threads = clone(loadStoredList(THREAD_KEY, defaultWorkbenchThreads));
if (!threads.some((thread) => thread.id === DEFAULT_WORKBENCH_THREAD_ID)) {
  threads = [clone(defaultWorkbenchThreads[0]), ...threads];
}

const defaultWorkbenchThreadId = threads.find((thread) => thread.id === DEFAULT_WORKBENCH_THREAD_ID)?.id ?? threads[0]?.id ?? '';
let activeThreadId = readStoredText(ACTIVE_THREAD_KEY, defaultWorkbenchThreadId);
if (!threads.some((thread) => thread.id === activeThreadId)) activeThreadId = defaultWorkbenchThreadId;
let activeModeId = readStoredText(ACTIVE_MODE_KEY, workbenchModes[0].id);
let lastRouteId = null;

const courseFilters = {
  keyword: '',
  category: '全部',
  priceType: 'all',
  track: '全部',
};

const resourceFilters = {
  keyword: '',
  category: '全部',
};

function readStoredText(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function saveStoredText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Static demo mode: ignore storage failures.
  }
}

function h(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function formatLines(value) {
  return h(value).replace(/\n/g, '<br />');
}

function $(selector, root = app) {
  return root.querySelector(selector);
}

function routeLink(routeId) {
  return `#/${routeId}`;
}

function currentRouteId() {
  return normalizeRouteId(window.location.hash);
}

function getRouteTitle(routeId) {
  return siteNavItems.find((item) => item.id === routeId)?.label ?? '首页';
}

function optionHtml(values, selectedValue) {
  return values.map((value) => `<option value="${h(value)}"${value === selectedValue ? ' selected' : ''}>${h(value)}</option>`).join('');
}

function getUniqueTracks() {
  return ['全部', ...new Set(courses.map((course) => course.track).filter(Boolean))];
}

function pageIntro(title, description) {
  return `
    <div class="page-intro">
      <h1>${h(title)}</h1>
      <p>${h(description)}</p>
    </div>
  `;
}

function renderNav(activeRouteId) {
  mainNav.innerHTML = siteNavItems
    .map((item) => `
      <a class="${item.id === activeRouteId ? 'active' : ''}" href="${h(item.href)}" data-route="${h(item.id)}">
        ${h(item.label)}
      </a>
    `)
    .join('');
}

function renderApp() {
  const routeId = currentRouteId();
  if (routeId === 'workbench' && shouldResetWorkbenchLanding()) {
    activeThreadId = defaultWorkbenchThreadId;
    activeModeId = workbenchModes[0].id;
  }
  document.body.dataset.route = routeId;
  renderNav(routeId);
  document.title = `${getRouteTitle(routeId)} | OPC社区AI课程与资源中心`;

  app.innerHTML = renderView(routeId);
  bindView(routeId);

  if (lastRouteId !== routeId) {
    window.scrollTo({ top: 0, behavior: 'auto' });
    lastRouteId = routeId;
  }
}

function renderView(routeId) {
  const renderers = {
    home: renderHomeView,
    courses: renderCoursesView,
    resources: renderResourcesView,
    route: renderRouteView,
    local: renderLocalView,
    workbench: renderWorkbenchView,
    wechat: renderWechatView,
    admin: renderAdminView,
  };
  return (renderers[routeId] ?? renderers.home)();
}

function bindView(routeId) {
  const binders = {
    courses: bindCoursesView,
    resources: bindResourcesView,
    workbench: bindWorkbenchView,
    wechat: bindWechatView,
    admin: bindAdminView,
  };
  binders[routeId]?.();
}

function shouldResetWorkbenchLanding() {
  try {
    if (sessionStorage.getItem(WORKBENCH_SESSION_KEY)) return false;
    sessionStorage.setItem(WORKBENCH_SESSION_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

function renderHomeView() {
  const featured = [
    {
      title: 'AI漫剧创作实践营',
      summary: '从脚本、分镜到成片，先做出可以展示的作品。',
      image: './assets/images/opc-poster.png',
    },
    {
      title: 'OPC导师墙与课程展示',
      summary: '把社区活动、课程宣传和学员作品放在同一条视觉线上。',
      image: './assets/images/mentor-wall-preview.png',
    },
    {
      title: '飞书知识库精选',
      summary: '把飞书资料提炼成摘要、场景和可复用的学习入口。',
      image: './assets/images/home-hero-city.png',
    },
  ];

  return `
    <section class="home-hero">
      <div class="home-copy">
        <h1>OPC社区AI课程<br />与资源中心</h1>
        <p>从课程、资源到实践，一站式进入OPC学习地图。先看方向，再进课程库、资源库和应用工作台，把想法变成可展示的AI作品。</p>
        <div class="hero-actions">
          <a class="primary-action" href="${routeLink('route')}">探索学习路线 →</a>
        </div>
      </div>
    </section>

    <section class="home-section">
      <div class="section-heading centered">
        <h2>精选内容导航</h2>
        <p>高质量课程 · 实用资源 · 清晰路径 · 社区共创</p>
      </div>
      <div class="home-highlight-grid">
        ${homeHighlights.map(renderHomeHighlight).join('')}
      </div>
    </section>

    <section class="home-section home-featured">
      <div class="section-heading">
        <h2>社区精选推荐</h2>
        <a class="text-link" href="${routeLink('resources')}">查看全部 →</a>
      </div>
      <div class="featured-grid">
        ${featured.map(renderFeaturedPreview).join('')}
      </div>
    </section>
  `;
}

function renderHomeHighlight(item) {
  return `
    <a class="home-highlight ${h(item.accent)}" href="${routeLink(item.route)}">
      <span class="highlight-icon">${renderHomeIcon(item.icon)}</span>
      <strong>${h(item.title)}</strong>
      <span>${h(item.summary)}</span>
      <em>→</em>
    </a>
  `;
}

function renderHomeIcon(name) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5v9l8-4.5-8-4.5Z" /></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1-2.5-2.5v-8Z" /></svg>',
    compass: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.8 9.2-1.4 4.2-4.2 1.4 1.4-4.2 4.2-1.4Zm-2.8 8.8a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" /></svg>',
    cube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 5 7v10l7 3.5 7-3.5V7l-7-3.5Zm0 2.1L16.9 8 12 10.4 7.1 8 12 5.6Zm-5.5 3.4 4.5 2.2v5.4l-4.5-2.2V9Zm11 0v5.4l-4.5 2.2v-5.4L17.5 9Z" /></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h10a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H6A2 2 0 0 0 4 18V6a2 2 0 0 1 2-2Zm10.5 12.5H6A1.5 1.5 0 0 0 4.5 18H16a1.5 1.5 0 0 1 .5-1.5Z" /></svg>',
  };
  return icons[name] ?? icons.book;
}

function renderFeaturedPreview(item) {
  return `
    <article class="featured-card">
      <img src="${h(item.image)}" alt="${h(item.title)}" />
      <div class="featured-copy">
        <span>精选内容</span>
        <h3>${h(item.title)}</h3>
        <p>${h(item.summary)}</p>
      </div>
    </article>
  `;
}

function renderCoursesView() {
  return `
    <section class="page-shell">
      ${pageIntro('课程库', '把公开课程、OPC自有课程和候选训练营拆成可筛选的学习入口。所有课程只做导览、学习目标和官方入口说明。')}
      <div class="filter-panel">
        <label>
          <span>搜索课程</span>
          <input id="courseKeyword" type="search" value="${h(courseFilters.keyword)}" placeholder="输入漫剧、电商、MOOC、OPC..." />
        </label>
        <label>
          <span>分类</span>
          <select id="courseCategory">${optionHtml(courseCategories, courseFilters.category)}</select>
        </label>
        <label>
          <span>价格</span>
          <select id="coursePrice">
            <option value="all"${courseFilters.priceType === 'all' ? ' selected' : ''}>全部</option>
            <option value="free"${courseFilters.priceType === 'free' ? ' selected' : ''}>免费/公开</option>
            <option value="paid"${courseFilters.priceType === 'paid' ? ' selected' : ''}>小预算候选</option>
          </select>
        </label>
        <label>
          <span>学习轨道</span>
          <select id="courseTrack">${optionHtml(getUniqueTracks(), courseFilters.track)}</select>
        </label>
      </div>
      <div class="content-grid course-grid" id="courseGrid" aria-live="polite"></div>
    </section>
  `;
}

function bindCoursesView() {
  const fields = ['courseKeyword', 'courseCategory', 'coursePrice', 'courseTrack'];
  fields.forEach((id) => {
    $(`#${id}`).addEventListener('input', () => {
      courseFilters.keyword = $('#courseKeyword').value;
      courseFilters.category = $('#courseCategory').value;
      courseFilters.priceType = $('#coursePrice').value;
      courseFilters.track = $('#courseTrack').value;
      renderCourseCards();
    });
  });
  renderCourseCards();
}

function renderCourseCards() {
  const grid = $('#courseGrid');
  const filtered = filterCourses(courses, courseFilters);

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">没有匹配课程。可以换个关键词，或在后台新增课程。</div>';
    return;
  }

  grid.innerHTML = filtered.map(renderCourseCard).join('');
}

function renderCourseCard(course) {
  return `
    <article class="course-card">
      <div class="card-meta">
        <span class="status-tag">${h(course.status)}</span>
        <span>${h(course.priceLabel)}</span>
      </div>
      <h2>${h(course.title)}</h2>
      <p>${h(course.outcome)}</p>
      <dl>
        <div><dt>分类</dt><dd>${h(course.category)}</dd></div>
        <div><dt>来源</dt><dd>${h(course.source)}</dd></div>
        <div><dt>适合</dt><dd>${h(course.audience)}</dd></div>
      </dl>
      <div class="chip-row">${course.syllabus.map((item) => `<span>${h(item)}</span>`).join('')}</div>
      <div class="rights-note">${h(course.rightsNote)}</div>
      <div class="card-actions">
        <a class="ghost-action" href="${h(course.officialUrl)}" target="_blank" rel="noreferrer">官方入口</a>
        <span>核验：${h(course.verifiedAt)}</span>
      </div>
    </article>
  `;
}

function renderResourcesView() {
  return `
    <section class="page-shell">
      ${pageIntro('AI资源', '工具导航、模型文档、办公提效入口和飞书知识库摘要集中在这里。资源只做入口推荐和场景导览。')}
      <div class="filter-panel compact">
        <label>
          <span>搜索资源</span>
          <input id="resourceKeyword" type="search" value="${h(resourceFilters.keyword)}" placeholder="输入WaytoAGI、工具、飞书、视频、主图..." />
        </label>
        <label>
          <span>资源分类</span>
          <select id="resourceCategory">${optionHtml(resourceCategories, resourceFilters.category)}</select>
        </label>
      </div>
      <div class="split-heading">
        <h2>工具与模型入口</h2>
        <p>适合日常使用和课程配套。</p>
      </div>
      <div class="content-grid resource-grid" id="resourceGrid" aria-live="polite"></div>
      <div class="split-heading">
        <h2>飞书知识库摘要</h2>
        <p>从已有飞书资料整理成可检索、可引用的场景卡片。</p>
      </div>
      <div class="content-grid knowledge-grid" id="knowledgeGrid" aria-live="polite"></div>
    </section>
  `;
}

function bindResourcesView() {
  ['resourceKeyword', 'resourceCategory'].forEach((id) => {
    $(`#${id}`).addEventListener('input', () => {
      resourceFilters.keyword = $('#resourceKeyword').value;
      resourceFilters.category = $('#resourceCategory').value;
      renderResourceCards();
      renderKnowledgeCards();
    });
  });
  renderResourceCards();
  renderKnowledgeCards();
}

function renderResourceCards() {
  const grid = $('#resourceGrid');
  const filtered = filterResources(resources, {
    keyword: resourceFilters.keyword,
    category: resourceFilters.category,
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">没有匹配资源。可以换个关键词，或在后台新增资源。</div>';
    return;
  }

  grid.innerHTML = filtered.map(renderResourceCard).join('');
}

function renderResourceCard(resource) {
  return `
    <article class="resource-card">
      <span class="resource-type">${h(resource.type)}</span>
      <h2>${h(resource.name)}</h2>
      <p>${h(resource.reason)}</p>
      <div class="chip-row">
        <span>${h(resource.category)}</span>
        <span>${h(resource.scenario)}</span>
        <span>${h(resource.audience)}</span>
      </div>
      <div class="rights-note">${h(resource.rightsNote)}</div>
      <a class="ghost-action" href="${h(resource.officialUrl)}" target="_blank" rel="noreferrer">访问官网</a>
    </article>
  `;
}

function renderKnowledgeCards() {
  const grid = $('#knowledgeGrid');
  const keyword = resourceFilters.keyword.trim().toLowerCase();
  const filtered = feishuKnowledgeItems.filter((item) => {
    const blob = [item.title, item.category, item.scenario, item.summary, item.tags.join(' ')].join(' ').toLowerCase();
    return !keyword || blob.includes(keyword);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">没有匹配的飞书知识库摘要。</div>';
    return;
  }

  grid.innerHTML = filtered.map(renderKnowledgeCard).join('');
}

function renderKnowledgeCard(item) {
  return `
    <article class="knowledge-card">
      <span class="resource-type">${h(item.category)}</span>
      <h2>${h(item.title)}</h2>
      <p>${h(item.summary)}</p>
      <div class="chip-row">${item.tags.map((tag) => `<span>${h(tag)}</span>`).join('')}</div>
      <div class="source-note">来源：${h(item.sourceName)}</div>
      <div class="rights-note">${h(item.rightsNote)}</div>
    </article>
  `;
}

function renderRouteView() {
  const stages = buildRoutePlan(courses);

  return `
    <section class="page-shell">
      ${pageIntro('学习路线', '面向普通学习者：先建立认知，再动手找工具，进入OPC实践，最后沉淀成可宣传的作品和文章。')}
      <div class="route-timeline">
        ${stages.map((stage, index) => `
          <article class="route-stage">
            <span class="stage-index">${String(index + 1).padStart(2, '0')}</span>
            <h2>${h(stage.title)}</h2>
            <p>${h(stage.description)}</p>
            <ul>
              ${stage.courses.map((course) => `<li>${h(course.title)}</li>`).join('') || '<li>可在后台补充课程</li>'}
            </ul>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLocalView() {
  const localCourses = courses.filter((course) => course.source === 'OPC社区');

  return `
    <section class="page-shell local-page">
      <div class="local-hero">
        <div>
          <h1>OPC课程</h1>
          <p>本地课程围绕AI漫剧、AI电商、AI超级个体三条线宣传。每次活动沉淀为课程页、公众号报道、学员作品展示和下一期报名入口。</p>
          <a class="primary-action" href="${routeLink('wechat')}">生成公众号素材</a>
        </div>
        <img src="./assets/images/mentor-wall-preview.png" alt="OPC导师墙与课程展示预览" />
      </div>
      <div class="local-track-grid">
        <article>
          <h2>AI漫剧</h2>
          <p>故事脚本、分镜、角色一致性、配音剪辑、作品发布。</p>
        </article>
        <article>
          <h2>AI电商</h2>
          <p>商品图、种草文案、短视频脚本、本地商户素材包。</p>
        </article>
        <article>
          <h2>AI超级个体</h2>
          <p>办公提效、个人品牌、知识库助手、公众号内容运营。</p>
        </article>
      </div>
      <div class="split-heading">
        <h2>当前OPC课程</h2>
        <p>这些课程可以作为线下活动、宣传文章和工作台试用的重点内容。</p>
      </div>
      <div class="content-grid course-grid">
        ${localCourses.map(renderCourseCard).join('') || '<div class="empty-state">暂无OPC本地课程，可在后台新增。</div>'}
      </div>
    </section>
  `;
}

function renderWechatView() {
  return `
    <section class="page-shell">
      ${pageIntro('公众号素材库', '从课程、资源和飞书知识库里选择素材，一键生成适合公众号初稿的文章结构。文案默认包含不承诺收益和版权边界说明。')}
      <div class="wechat-layout">
        <div class="composer-panel">
          <label>
            <span>文章模板</span>
            <select id="wechatTemplate"></select>
          </label>
          <label>
            <span>选择课程</span>
            <select id="wechatCourses" multiple size="7"></select>
          </label>
          <label>
            <span>选择资源</span>
            <select id="wechatResources" multiple size="6"></select>
          </label>
          <button class="primary-action full" id="generateWechat" type="button">生成公众号初稿</button>
        </div>
        <textarea id="wechatOutput" class="wechat-output" aria-label="公众号文案输出"></textarea>
      </div>
    </section>
  `;
}

function bindWechatView() {
  $('#wechatTemplate').innerHTML = defaultWechatTemplates.map((template) => `<option value="${h(template.id)}">${h(template.name)}</option>`).join('');
  $('#wechatCourses').innerHTML = courses.map((course) => `<option value="${h(course.id)}">${h(course.title)}｜${h(course.category)}</option>`).join('');
  $('#wechatResources').innerHTML = resources.map((resource) => `<option value="${h(resource.id)}">${h(resource.name)}｜${h(resource.category)}</option>`).join('');

  $('#generateWechat').addEventListener('click', renderWechatCopy);
  renderWechatCopy();
}

function selectedOptions(select) {
  return [...select.selectedOptions].map((item) => item.value);
}

function renderWechatCopy() {
  const template = defaultWechatTemplates.find((item) => item.id === $('#wechatTemplate').value) ?? defaultWechatTemplates[0];
  const selectedCourseIds = selectedOptions($('#wechatCourses'));
  const selectedResourceIds = selectedOptions($('#wechatResources'));
  const chosenCourses = courses.filter((course) => selectedCourseIds.includes(course.id)).slice(0, 4);
  const chosenResources = resources.filter((resource) => selectedResourceIds.includes(resource.id)).slice(0, 4);
  const fallbackCourses = chosenCourses.length ? chosenCourses : courses.filter((course) => course.status === '推荐').slice(0, 3);
  const fallbackResources = chosenResources.length ? chosenResources : resources.slice(0, 2);

  $('#wechatOutput').value = generateWechatCopy(template, fallbackCourses, fallbackResources);
}

function renderAdminView() {
  return `
    <section class="page-shell">
      ${pageIntro('后台管理', '首版后台使用浏览器本地存储，适合先维护课程和资源。正式上线前可以导出JSON作为种子数据。')}
      <div class="admin-grid">
        <form class="admin-form" id="courseForm">
          <h2>新增课程</h2>
          <label><span>标题</span><input name="title" required /></label>
          <label><span>分类</span><select name="category">${optionHtml(courseCategories.filter((item) => item !== '全部'), 'AI入门')}</select></label>
          <label><span>来源</span><input name="source" required placeholder="OPC社区 / 官方平台" /></label>
          <label><span>官方链接</span><input name="officialUrl" required type="url" placeholder="https://..." /></label>
          <label><span>适合人群</span><textarea name="audience" required></textarea></label>
          <label><span>学习目标</span><textarea name="outcome" required></textarea></label>
          <button class="primary-action full" type="submit">保存课程到本地</button>
        </form>
        <form class="admin-form" id="resourceForm">
          <h2>新增资源</h2>
          <label><span>名称</span><input name="name" required /></label>
          <label><span>分类</span><select name="category">${optionHtml(resourceCategories.filter((item) => item !== '全部'), '工具导航')}</select></label>
          <label><span>类型</span><input name="type" required placeholder="AI资源导航 / 官方文档" /></label>
          <label><span>官方链接</span><input name="officialUrl" required type="url" placeholder="https://..." /></label>
          <label><span>使用场景</span><textarea name="scenario" required></textarea></label>
          <label><span>推荐理由</span><textarea name="reason" required></textarea></label>
          <button class="primary-action full" type="submit">保存资源到本地</button>
        </form>
        <div class="export-panel">
          <h2>数据维护</h2>
          <p>本地编辑只保存在当前浏览器。导出数据包含课程、资源和飞书知识库摘要。</p>
          <div class="button-row">
            <button class="ghost-action" id="exportData" type="button">导出JSON</button>
            <button class="danger-action" id="resetData" type="button">恢复初始数据</button>
          </div>
          <textarea id="exportOutput" aria-label="导出的JSON数据"></textarea>
        </div>
      </div>
    </section>
  `;
}

function bindAdminView() {
  $('#courseForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    courses = [
      {
        id: `local-course-${Date.now()}`,
        title: data.title,
        category: data.category,
        track: '本地补充',
        priceType: 'free',
        priceLabel: '本地维护',
        source: data.source,
        level: '待完善',
        audience: data.audience,
        outcome: data.outcome,
        syllabus: ['后台新增课程', '待补充目录', '待补充作品要求'],
        recommendation: '由后台新增，建议上线前补齐课程目录和宣传口径。',
        rightsNote: '后台新增课程仅做导览展示，不搬运付费或内部课件。',
        officialUrl: data.officialUrl,
        verifiedAt: new Date().toISOString().slice(0, 10),
        status: '待复核',
      },
      ...courses,
    ];
    saveStoredList(COURSE_KEY, courses);
    event.currentTarget.reset();
    renderApp();
  });

  $('#resourceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    resources = [
      {
        id: `local-resource-${Date.now()}`,
        name: data.name,
        category: data.category,
        type: data.type,
        scenario: data.scenario,
        audience: 'OPC社区学习者',
        reason: data.reason,
        officialUrl: data.officialUrl,
        verifiedAt: new Date().toISOString().slice(0, 10),
        rightsNote: '后台新增资源仅做入口推荐和简短导览。',
      },
      ...resources,
    ];
    saveStoredList(RESOURCE_KEY, resources);
    event.currentTarget.reset();
    renderApp();
  });

  $('#exportData').addEventListener('click', () => {
    $('#exportOutput').value = JSON.stringify({ courses, resources, feishuKnowledgeItems }, null, 2);
  });

  $('#resetData').addEventListener('click', () => {
    courses = clone(defaultCourses);
    resources = clone(defaultResources);
    saveStoredList(COURSE_KEY, courses);
    saveStoredList(RESOURCE_KEY, resources);
    $('#exportOutput').value = '已恢复初始课程和资源数据。';
    renderApp();
  });
}

function renderWorkbenchView() {
  const thread = getActiveThread();
  const mode = getActiveMode();

  return `
    <section class="workbench-page doubao-workbench">
      ${renderWorkbenchSidebar(thread)}
      <section class="doubao-main" aria-label="当前对话">
        <header class="doubao-topbar">
          <button class="doubao-icon-button panel-toggle" type="button" aria-label="展开或收起侧栏">${renderUtilityIcon('panel')}</button>
          <div class="doubao-title">
            <strong>${h(thread.messages.length ? thread.title : '新对话')}</strong>
            <span>AI 生成可能有误 请核实</span>
          </div>
          <div class="doubao-top-actions" aria-label="对话操作">
            <button class="doubao-icon-button" type="button" aria-label="静音">${renderUtilityIcon('mute')}</button>
            <button class="doubao-icon-button ghosted" type="button" aria-label="分享">${renderUtilityIcon('shareArrow')}</button>
          </div>
        </header>
        ${thread.messages.length ? renderWorkbenchMessages(thread) : renderWorkbenchLanding()}
        ${renderWorkbenchComposer(mode)}
      </section>
    </section>
  `;
}

function renderWorkbenchSidebar(activeThread) {
  return `
    <aside class="workbench-sidebar doubao-sidebar" aria-label="工作台侧栏">
      <label class="doubao-search">
        ${renderUtilityIcon('search')}
        <input type="search" placeholder="搜索..." aria-label="搜索对话" />
        <span>Ctrl K</span>
      </label>
      <div class="doubao-profile">
        <span class="doubao-avatar" aria-hidden="true">${renderUtilityIcon('user')}</span>
        <strong>豆包</strong>
      </div>
      <nav class="doubao-sidebar-nav" aria-label="工作台功能">
        ${workbenchSidebarActions.map((item) => renderSidebarAction(item, activeThread.id === DEFAULT_WORKBENCH_THREAD_ID)).join('')}
      </nav>
      <section class="doubao-history" aria-label="历史对话">
        <h2>历史对话</h2>
        ${threads.map((thread, index) => renderHistoryItem(thread, index)).join('')}
      </section>
      <div class="doubao-account">
        <span class="account-avatar">${renderUtilityIcon('user')}</span>
        <strong>foxnotail</strong>
        <span>›</span>
      </div>
    </aside>
  `;
}

function renderSidebarAction(item, newChatActive) {
  const isNewChat = item.id === 'new-chat';

  return `
    <button
      class="doubao-sidebar-action ${isNewChat && newChatActive ? 'active' : ''}"
      id="${isNewChat ? 'newThread' : ''}"
      type="button"
    >
      ${renderUtilityIcon(item.icon)}
      <span>${h(item.label)}</span>
      ${item.shortcut ? `<small>${h(item.shortcut)}</small>` : ''}
      ${item.trailing ? '<em>›</em>' : ''}
    </button>
  `;
}

function renderHistoryItem(thread, index) {
  const title = thread.title.length > 18 ? `${thread.title.slice(0, 18)}...` : thread.title;

  return `
    <button class="doubao-history-item ${thread.id === activeThreadId ? 'active' : ''}" type="button" data-thread-id="${h(thread.id)}">
      <span class="history-bubble">${renderUtilityIcon('chat')}</span>
      <span class="history-title">${h(title)}</span>
      ${index === 3 || index === 9 ? '<strong class="history-badge">1</strong>' : ''}
    </button>
  `;
}

function renderWorkbenchLanding() {
  return `
    <div class="doubao-landing">
      <h1>有什么我能帮你的吗？</h1>
      <div class="doubao-prompt-grid" aria-label="快捷提示词">
        ${workbenchQuickPrompts.map((prompt) => `
          <button type="button" data-sample="${h(prompt)}">${h(prompt)}</button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderWorkbenchMessages(thread) {
  return `
    <div class="message-stream doubao-message-stream" id="messageStream">
      ${thread.messages.map(renderMessage).join('')}
    </div>
  `;
}

function renderWorkbenchComposer(mode) {
  return `
    <form class="doubao-composer" id="workbenchForm">
      <textarea id="workbenchInput" rows="2" placeholder="发消息或按住空格说话..."></textarea>
      <div class="doubao-composer-tools">
        <button class="composer-plus" type="button" aria-label="添加">${renderUtilityIcon('plus')}</button>
        <span class="composer-divider"></span>
        ${workbenchToolActions.map((item) => `
          <button type="button" data-tool-mode="${h(item.mode)}" data-sample="${h(item.label === '快速' ? mode.sampleAction : item.label)}">
            ${renderUtilityIcon(item.icon)}
            <span>${h(item.label)}</span>
          </button>
        `).join('')}
        <button class="voice-button" type="button" aria-label="语音输入">${renderUtilityIcon('voice')}</button>
        <button class="send-button doubao-send" type="submit" aria-label="发送">${renderUtilityIcon('arrowUp')}</button>
      </div>
    </form>
  `;
}

function renderMessage(message) {
  const body = formatMessageContent(message.content);

  return `
    <article class="message doubao-message ${message.role === 'user' ? 'user' : 'assistant'}">
      ${
        message.role === 'user'
          ? `<div class="message-body user-bubble">${body}</div>`
          : `<div class="message-avatar assistant-avatar">豆</div><div class="message-body assistant-bubble">${body}</div>`
      }
    </article>
  `;
}

function formatMessageContent(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!text.includes('```')) {
    return `<p>${formatLines(text).replace(/\n/g, '</p><p>')}</p>`;
  }

  const segments = [];
  let lastIndex = 0;
  const pattern = /```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    const [full, code] = match;
    const start = match.index ?? 0;
    const before = text.slice(lastIndex, start).trim();
    if (before) segments.push(`<p>${formatLines(before).replace(/\n/g, '</p><p>')}</p>`);
    segments.push(`<pre class="message-code"><code>${h(code.trim())}</code></pre>`);
    lastIndex = start + full.length;
  }

  const tail = text.slice(lastIndex).trim();
  if (tail) segments.push(`<p>${formatLines(tail).replace(/\n/g, '</p><p>')}</p>`);
  return segments.join('');
}

function renderUtilityIcon(name) {
  const icons = {
    ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 14.2 9l5.8.5-4.4 3.8 1.4 5.7-5-3-5 3 1.4-5.7L4 9.5 9.8 9 12 3.5Z" /></svg>',
    arrowUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18V8.8l-4.1 4.1-1.4-1.4L12 5l6.5 6.5-1.4 1.4L13 8.8V18h-2Z" /></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-7 12h5l-1 8 8-13h-5l0-7Z" /></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9.8L6 18.6v-3.1H5v-10Zm3 4h8v-1.7H8v1.7Zm0 3.5h6v-1.7H8V13Z" /></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 18h8.3a4.2 4.2 0 0 0 .4-8.4 6 6 0 0 0-11.3 1.7A3.4 3.4 0 0 0 8.5 18Zm0-2a1.4 1.4 0 0 1-.4-2.7l1.2-.3.1-1.3a4 4 0 0 1 7.7-1.2l.4 1.1h1.1a2.2 2.2 0 0 1 0 4.4H8.5Z" /></svg>',
    code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.4 16.6-1.4 1.4L2 12l6-6 1.4 1.4L4.8 12l4.6 4.6Zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z" /></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.2V20h2.8l9.7-9.7-2.8-2.8L4 17.2Zm13.8-8.2 1-1a1.8 1.8 0 0 0 0-2.5l-.3-.3a1.8 1.8 0 0 0-2.5 0l-1 1 2.8 2.8Z" /></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" /></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Zm2 2v8.4l3.6-3.5 2.5 2.4 3.2-4L18 14V7H6Zm3 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm5 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Zm5 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" /></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.2L12 5v14l-4.8-4H4V9Zm13.6-.6 1.4 1.4-2.2 2.2 2.2 2.2-1.4 1.4-2.2-2.2-2.2 2.2-1.4-1.4 2.2-2.2-2.2-2.2 1.4-1.4 2.2 2.2 2.2-2.2Z" /></svg>',
    office: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h9l5 5v11H5V4Zm8 2v4h4l-4-4ZM8 13h8v-1.8H8V13Zm0 4h8v-1.8H8V17Z" /></svg>',
    panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Zm2 2v10h4V7H6Zm6 0v10h6V7h-6Z" /></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" /></svg>',
    ppt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5V4Zm3 3v10h2v-3h2.2A3.2 3.2 0 0 0 15.4 10 3.2 3.2 0 0 0 12.2 7H8Zm2 2h2.1c.8 0 1.3.4 1.3 1s-.5 1.1-1.3 1.1H10V9Z" /></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 0 1 5.1 10.5l4 4-1.4 1.4-4-4A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" /></svg>',
    shareArrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5v4.2c-5 .8-8 3.7-9.6 8.8 2.6-2.7 5.6-3.8 9.6-3.8V19l7-7-7-7Z" /></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z" /></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11v12H4V6Zm13 3.5 4-2.5v10l-4-2.5v-5Z" /></svg>',
    voice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9h2v6H6V9Zm5-4h2v14h-2V5Zm5 4h2v6h-2V9Z" /></svg>',
    write: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v3H5V4Zm0 5h10v2H5V9Zm0 4h14v2H5v-2Zm0 4h8v2H5v-2Z" /></svg>',
  };
  return icons[name] ?? icons.more;
}

function bindWorkbenchView() {
  app.querySelectorAll('[data-thread-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activeThreadId = button.dataset.threadId;
      const thread = getActiveThread();
      activeModeId = thread.mode ?? activeModeId;
      saveWorkbenchState();
      renderApp();
    });
  });

  app.querySelectorAll('[data-mode-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activeModeId = button.dataset.modeId;
      const thread = getActiveThread();
      thread.mode = activeModeId;
      saveWorkbenchState();
      renderApp();
    });
  });

  app.querySelectorAll('[data-tool-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      activeModeId = button.dataset.toolMode;
      saveStoredText(ACTIVE_MODE_KEY, activeModeId);
    });
  });

  app.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      $('#workbenchInput').value = button.dataset.sample;
      $('#workbenchInput').focus();
    });
  });

  $('#newThread').addEventListener('click', () => {
    const mode = getActiveMode();
    const thread = {
      id: `thread-${Date.now()}`,
      title: '新对话',
      pinned: false,
      dateLabel: '',
      mode: mode.id,
      messages: [],
    };
    threads = [thread, ...threads];
    activeThreadId = thread.id;
    activeModeId = mode.id;
    saveWorkbenchState();
    renderApp();
  });

  $('#workbenchForm').addEventListener('submit', (event) => {
    event.preventDefault();
    sendWorkbenchMessage($('#workbenchInput').value);
  });

  $('#workbenchInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendWorkbenchMessage(event.currentTarget.value);
    }
  });
}

function getActiveMode() {
  const mode = workbenchModes.find((item) => item.id === activeModeId) ?? workbenchModes[0];
  activeModeId = mode.id;
  return mode;
}

function getActiveThread() {
  const thread = threads.find((item) => item.id === activeThreadId) ?? threads[0];
  activeThreadId = thread.id;
  return thread;
}

function sendWorkbenchMessage(rawValue) {
  const content = rawValue.trim();
  if (!content) return;

  const thread = getActiveThread();
  const reply = buildWorkbenchReply(activeModeId, content, thread, {
    courses,
    resources,
    feishuKnowledgeItems,
  });

  thread.messages.push({ role: 'user', content });
  thread.messages.push({ role: 'assistant', content: reply });
  thread.mode = activeModeId;
  thread.dateLabel = '刚刚';
  const firstUserMessage = thread.messages.find((message) => message.role === 'user')?.content;
  if (firstUserMessage) thread.title = firstUserMessage.slice(0, 18);

  saveWorkbenchState();
  renderApp();
  requestAnimationFrame(() => {
    const stream = $('#messageStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  });
}

function saveWorkbenchState() {
  saveStoredList(THREAD_KEY, threads);
  saveStoredText(ACTIVE_THREAD_KEY, activeThreadId);
  saveStoredText(ACTIVE_MODE_KEY, activeModeId);
}

window.addEventListener('hashchange', renderApp);
renderApp();
