import {
  buildRoutePlan,
  courseCategories,
  defaultCourses,
  defaultResources,
  defaultWechatTemplates,
  filterCourses,
  filterResources,
  generateWechatCopy,
  getDashboardStats,
  loadStoredList,
  resourceCategories,
  saveStoredList,
} from './app-data.mjs';

const COURSE_KEY = 'opc-course-hub:courses';
const RESOURCE_KEY = 'opc-course-hub:resources';

let courses = loadStoredList(COURSE_KEY, defaultCourses);
let resources = loadStoredList(RESOURCE_KEY, defaultResources);

const $ = (selector) => document.querySelector(selector);

function option(value, label = value) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function fillSelect(select, values) {
  select.replaceChildren(...values.map((value) => option(value)));
}

function getUniqueTracks() {
  return ['全部', ...new Set(courses.map((course) => course.track).filter(Boolean))];
}

function tagClass(value) {
  if (value === '推荐') return 'tag hot';
  if (value === '待复核') return 'tag warn';
  return 'tag';
}

function renderStats() {
  const stats = getDashboardStats(courses, resources);
  Object.entries(stats).forEach(([key, value]) => {
    const target = document.querySelector(`[data-stat="${key}"]`);
    if (target) target.textContent = value;
  });
}

function renderCourses() {
  const filters = {
    keyword: $('#courseKeyword').value,
    category: $('#courseCategory').value,
    priceType: $('#coursePrice').value,
    track: $('#courseTrack').value,
  };
  const filtered = filterCourses(courses, filters);
  const grid = $('#courseGrid');

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">没有匹配课程。可以换个关键词，或在后台新增课程。</div>';
    return;
  }

  grid.replaceChildren(
    ...filtered.map((course) => {
      const card = document.createElement('article');
      card.className = 'course-card';
      card.innerHTML = `
        <div class="card-meta">
          <span class="${tagClass(course.status)}">${course.status}</span>
          <span>${course.priceLabel}</span>
        </div>
        <h3>${course.title}</h3>
        <p>${course.outcome}</p>
        <dl>
          <div><dt>分类</dt><dd>${course.category}</dd></div>
          <div><dt>来源</dt><dd>${course.source}</dd></div>
          <div><dt>适合</dt><dd>${course.audience}</dd></div>
        </dl>
        <div class="syllabus">
          ${course.syllabus.map((item) => `<span>${item}</span>`).join('')}
        </div>
        <div class="rights-note">${course.rightsNote}</div>
        <div class="card-actions">
          <a class="ghost-action" href="${course.officialUrl}" target="_blank" rel="noreferrer">官方入口</a>
          <span>核验：${course.verifiedAt}</span>
        </div>
      `;
      return card;
    }),
  );
}

function renderResources() {
  const filtered = filterResources(resources, {
    keyword: $('#resourceKeyword').value,
    category: $('#resourceCategory').value,
  });
  const grid = $('#resourceGrid');

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">没有匹配资源。可以换个关键词，或在后台新增资源。</div>';
    return;
  }

  grid.replaceChildren(
    ...filtered.map((resource) => {
      const card = document.createElement('article');
      card.className = 'resource-card';
      card.innerHTML = `
        <div class="resource-type">${resource.type}</div>
        <h3>${resource.name}</h3>
        <p>${resource.reason}</p>
        <div class="resource-fields">
          <span>${resource.category}</span>
          <span>${resource.scenario}</span>
          <span>${resource.audience}</span>
        </div>
        <div class="rights-note">${resource.rightsNote}</div>
        <a class="ghost-action" href="${resource.officialUrl}" target="_blank" rel="noreferrer">访问官网</a>
      `;
      return card;
    }),
  );
}

function renderRoute() {
  const timeline = $('#routeTimeline');
  const stages = buildRoutePlan(courses);
  timeline.replaceChildren(
    ...stages.map((stage, index) => {
      const node = document.createElement('article');
      node.className = 'route-stage';
      node.innerHTML = `
        <span class="stage-index">${String(index + 1).padStart(2, '0')}</span>
        <h3>${stage.title}</h3>
        <p>${stage.description}</p>
        <ul>
          ${stage.courses.map((course) => `<li>${course.title}</li>`).join('') || '<li>可在后台补充课程</li>'}
        </ul>
      `;
      return node;
    }),
  );
}

function renderWechatSelectors() {
  $('#wechatTemplate').replaceChildren(...defaultWechatTemplates.map((template) => option(template.id, template.name)));
  $('#wechatCourses').replaceChildren(...courses.map((course) => option(course.id, `${course.title}｜${course.category}`)));
  $('#wechatResources').replaceChildren(...resources.map((resource) => option(resource.id, `${resource.name}｜${resource.category}`)));
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

function setupAdminForms() {
  fillSelect($('#courseForm select[name="category"]'), courseCategories.filter((item) => item !== '全部'));
  fillSelect($('#resourceForm select[name="category"]'), resourceCategories.filter((item) => item !== '全部'));

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
    hydrate();
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
    hydrate();
  });

  $('#exportData').addEventListener('click', () => {
    $('#exportOutput').value = JSON.stringify({ courses, resources }, null, 2);
  });

  $('#resetData').addEventListener('click', () => {
    courses = defaultCourses;
    resources = defaultResources;
    saveStoredList(COURSE_KEY, courses);
    saveStoredList(RESOURCE_KEY, resources);
    hydrate();
    $('#exportOutput').value = '已恢复初始数据。';
  });
}

function bindFilters() {
  ['#courseKeyword', '#courseCategory', '#coursePrice', '#courseTrack'].forEach((selector) => {
    $(selector).addEventListener('input', renderCourses);
  });
  ['#resourceKeyword', '#resourceCategory'].forEach((selector) => {
    $(selector).addEventListener('input', renderResources);
  });
  $('#generateWechat').addEventListener('click', renderWechatCopy);
}

function hydrate() {
  fillSelect($('#courseCategory'), courseCategories);
  fillSelect($('#courseTrack'), getUniqueTracks());
  fillSelect($('#resourceCategory'), resourceCategories);
  renderStats();
  renderCourses();
  renderResources();
  renderRoute();
  renderWechatSelectors();
  renderWechatCopy();
}

function boot() {
  hydrate();
  setupAdminForms();
  bindFilters();
}

boot();
