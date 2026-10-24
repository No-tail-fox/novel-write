"""Verify standard controls in the isolated browser preview, without API calls."""
import json
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/controls-first-ui'
URL = os.environ.get('STORYDREAM_QA_URL', 'http://127.0.0.1:5207/')


def select_section(page, section, title):
    if page.viewport_size['width'] <= 760:
        page.get_by_role('combobox', name='设置分类', exact=True).select_option(section)
    else:
        page.locator('.settings-navigation').get_by_role('tab', name=title).click()
    expect(page.locator('.settings-heading h2')).to_have_text(title)


def metrics(page):
    return page.evaluate('''async () => {
      await document.fonts.ready;
      await Promise.race([
        Promise.all(document.getAnimations().filter(animation =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
        ).map(animation => animation.finished.catch(() => {}))),
        new Promise(resolve => setTimeout(resolve, 500)),
      ]);
      const visible = n => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
      const region = document.querySelector('.settings-layout, .task-queue-view, .history-page, .new-task-scroll, .prompt-template-gallery, .prompt-template-detail, .local-lab-workbench, .hv-create-page, .hv-studio');
      const inputs = [...region.querySelectorAll('.fui-Input')].filter(visible);
      const controls = [...region.querySelectorAll('button, input, select, textarea')].filter(visible);
      const footer = region.querySelector('.new-task-stage-footer');
      const panel = footer?.previousElementSibling;
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        regionOverflow: region.scrollWidth > region.clientWidth + 1,
        rawControls: controls.filter(n => !n.className.includes('fui-')).map(n => n.outerHTML.slice(0, 100)),
        inputs: inputs.map(n => {
          const s = getComputedStyle(n), input = n.querySelector('input'), i = getComputedStyle(input);
          return {height:n.getBoundingClientRect().height, display:s.display, border:s.borderTopWidth,
            background:s.backgroundColor, innerBorder:i.borderTopWidth, innerPadding:i.paddingLeft,
            label:input.getAttribute('aria-labelledby')};
        }),
        clippedButtons: controls.filter(n => n.tagName === 'BUTTON' && n.scrollWidth > n.clientWidth + 2).map(n => n.textContent),
        footerOverlapsContent: Boolean(footer && panel && panel.getBoundingClientRect().bottom > footer.getBoundingClientRect().top),
      };
    }''')


def button_contrast(button):
    return button.evaluate('''n => {
      const s = getComputedStyle(n), text = getComputedStyle(n.querySelector('.sd-button__content') || n);
      const luminance = value => {
        const c = value.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => {
          v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        });
        return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
      };
      const foreground = luminance(text.color), background = luminance(s.backgroundColor);
      return {foreground: text.color, background: s.backgroundColor,
        ratio: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)};
    }''')


def navigate(page, primary, secondary=None):
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.locator(f'.nav-list [data-nav-view={primary}][data-nav-level=primary]').click()
    leave = page.get_by_role('dialog', name='保留未保存的改动？', exact=True)
    if leave.is_visible():
        leave.get_by_role('button', name='保存并离开', exact=True).click()
        expect(leave).not_to_be_visible()
    if secondary:
        page.locator(f'[data-nav-view={secondary}]').click()


def capture_grid(page, report, prefix, ready):
    for theme in ['light', 'dark']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        for width, height in [(1440, 900), (1024, 768), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            expect(ready).to_be_visible()
            data = metrics(page)
            if prefix == 'voice-lab' and width <= 820:
                assert ready.locator('.voice-lab-controls').evaluate('''(n) =>
                  n.getBoundingClientRect().bottom <= n.nextElementSibling.getBoundingClientRect().top
                '''), (prefix, theme, width, 'controls overlap voice history')
            if prefix == 'benchmark':
                assert ready.locator('.benchmark-post-row').evaluate_all('''rows => rows.every(row =>
                  row.scrollWidth <= row.clientWidth + 1
                )'''), (prefix, theme, width, 'post row clips actions')
            name = f'{prefix}-{theme}-{width}.png'
            page.screenshot(path=OUTPUT / name, animations='disabled')
            report['captures'].append({'file': name, **data})
            assert not data['overflow'] and not data['regionOverflow'], (name, data)
            assert not data['rawControls'] and not data['clippedButtons'], (name, data)
            print(name, flush=True)
    page.set_viewport_size({'width': 1440, 'height': 900})


def verify_templates_labs(page, report):
    navigate(page, 'prompt-templates')
    gallery = page.locator('.prompt-template-gallery')
    capture_grid(page, report, 'prompt-gallery-story', gallery)
    gallery.get_by_role('button', name='新建模板', exact=True).click()
    detail = page.locator('.prompt-template-detail')
    name = detail.get_by_role('textbox', name='模板名', exact=True)
    name.fill('控件验收故事模板')
    detail.get_by_role('textbox', name='描述（一句话说明这个模板的特点）', exact=True).fill('本地控件回归样例')
    detail.get_by_role('button', name='保存修改', exact=True).click()
    capture_grid(page, report, 'prompt-editor-story', detail)
    detail.get_by_role('button', name='返回模板库', exact=True).click()
    expect(gallery.locator('strong').filter(has_text='控件验收故事模板')).to_be_visible()
    gallery.get_by_role('tab', name='图像模板', exact=True).click()
    capture_grid(page, report, 'prompt-gallery-image', gallery)
    gallery.get_by_role('button', name='新建模板', exact=True).click()
    detail.get_by_role('textbox', name='名称', exact=True).fill('控件验收图像模板')
    detail.get_by_role('combobox', name='色彩模式', exact=True).select_option('mono')
    detail.get_by_role('button', name='保存修改', exact=True).click()
    capture_grid(page, report, 'prompt-editor-image', detail)
    detail.get_by_role('button', name='返回模板库', exact=True).click()
    report['interactions'].append('story/image template create, standard fields, save and gallery return')

    navigate(page, 'person-assets', 'voice-lab')
    voice = page.locator('[data-local-lab-workbench=voice-lab]')
    voice.get_by_role('tablist', name='配音模型', exact=True).get_by_role('tab', name='MiniMax', exact=True).click()
    choices = voice.get_by_role('combobox', name='音色', exact=True)
    selected = choices.input_value()
    voice.get_by_role('textbox', name='搜索音色', exact=True).fill('没有匹配的验收音色')
    expect(choices).to_have_value(selected)
    expect(voice.get_by_text('没有匹配的音色', exact=True)).to_be_visible()
    voice.get_by_role('textbox', name='搜索音色', exact=True).fill('')
    voice.get_by_role('tab', name='快速 1.15x', exact=True).click()
    text = voice.get_by_role('textbox', name='试听文案', exact=True)
    text.fill('')
    expect(voice.get_by_role('button', name='生成试听', exact=True)).to_be_disabled()
    text.fill('本地控件验收，保留音色和语速，不提交生成。')
    capture_grid(page, report, 'voice-lab', voice)
    report['interactions'].append('voice provider/search/current selection retention, speed and empty-text guard')

    navigate(page, 'person-assets', 'image-lab')
    image = page.locator('[data-local-lab-workbench=image-lab]')
    modes = image.get_by_role('tablist', name='模式', exact=True)
    modes.get_by_role('tab', name='文生图', exact=True).click()
    prompt = image.get_by_role('textbox', name='需求描述', exact=True)
    prompt.fill('控件验收图片提示词，不调用生图接口。')
    image.get_by_role('textbox', name='提示词模板名称', exact=True).fill('控件验收图片预设')
    image.get_by_role('button', name='保存当前提示词模板', exact=True).click()
    templates = image.get_by_role('combobox', name='选择提示词模板', exact=True)
    saved_id = templates.input_value()
    prompt.fill('临时改动')
    templates.select_option('')
    templates.select_option(saved_id)
    expect(prompt).to_have_value('控件验收图片提示词，不调用生图接口。')
    slider = image.get_by_role('slider', name='每组合数量', exact=True)
    before = int(slider.input_value())
    slider.focus()
    slider.press('ArrowRight')
    expect(slider).to_have_value(str(before + 1))
    image.get_by_role('button', name='删除提示词模板', exact=True).click()
    expect(templates.locator('option', has_text='控件验收图片预设')).to_have_count(0)
    for mode, key in [('智慧生图', 'smart'), ('文生图', 'text'), ('图像参考', 'reference')]:
        modes.get_by_role('tab', name=mode, exact=True).click()
        capture_grid(page, report, f'image-lab-{key}', image)
    expect(image.get_by_role('button', name=re.compile('智能生成'))).to_be_disabled()
    report['interactions'].append('image modes, local prompt template save/apply/delete, keyboard slider and missing-reference guard')


def verify_benchmark(page, report):
    navigate(page, 'hot-board', 'benchmark')
    benchmark = page.locator('[data-local-lab-workbench=benchmark]')
    benchmark.locator('.benchmark-local-toolbar').get_by_role('button', name='添加对标组', exact=True).click()
    dialog = page.get_by_role('dialog', name='添加对标组', exact=True)
    expect(dialog.get_by_role('button', name='保存对标组', exact=True)).to_be_disabled()
    dialog.get_by_role('textbox', name='对标组名称', exact=True).fill('控件验收对标组')
    dialog.get_by_role('textbox', name='赛道', exact=True).fill('历史文化')
    dialog.get_by_role('textbox', name='B 站 UP 主空间链接', exact=True).fill('https://space.bilibili.com/123456')
    for width in [1440, 390]:
        page.set_viewport_size({'width': width, 'height': 900})
        page.screenshot(path=OUTPUT / f'benchmark-group-dialog-{width}.png', animations='disabled')
        assert dialog.evaluate('(n) => n.scrollWidth <= n.clientWidth + 1')
    dialog.get_by_role('button', name='保存对标组', exact=True).click()
    expect(dialog).not_to_be_visible()
    page.set_viewport_size({'width': 1440, 'height': 900})
    benchmark.get_by_role('button', name='导入作品', exact=True).first.click()
    post = page.get_by_role('dialog', name='导入作品与指标快照', exact=True)
    expect(post.get_by_role('button', name='保存作品', exact=True)).to_be_disabled()
    post.get_by_role('combobox', name='平台', exact=True).select_option('bilibili')
    post.get_by_role('textbox', name='来源链接', exact=True).fill('https://www.bilibili.com/video/BV1xx411c7mD/')
    post.get_by_role('textbox', name='账号 / 标题', exact=True).fill('控件验收作品')
    post.get_by_role('textbox', name='账号名称', exact=True).fill('本地验收账号')
    post.get_by_role('textbox', name='对标文案', exact=True).fill('仅在隔离浏览器中保存的本地验收文案。')
    post.get_by_role('spinbutton', name='播放', exact=True).fill('12345')
    post.get_by_role('spinbutton', name='点赞', exact=True).fill('456')
    for width in [1440, 390]:
        page.set_viewport_size({'width': width, 'height': 900})
        page.screenshot(path=OUTPUT / f'benchmark-post-dialog-{width}.png', animations='disabled')
        assert post.evaluate('(n) => n.scrollWidth <= n.clientWidth + 1')
    post.get_by_role('button', name='保存作品', exact=True).click()
    expect(post).not_to_be_visible()
    page.set_viewport_size({'width': 1440, 'height': 900})
    expect(benchmark.locator('.benchmark-post-row')).to_have_count(1)
    benchmark.get_by_role('button', name='收藏', exact=True).click()
    benchmark.get_by_role('checkbox', name='只看收藏', exact=True).check()
    expect(benchmark.locator('.benchmark-post-row')).to_have_count(1)
    note = benchmark.locator('.benchmark-inspector').get_by_role('textbox', name='备注', exact=True)
    note.fill('控件验收备注')
    benchmark.get_by_role('button', name='保存备注', exact=True).click()
    expect(benchmark.get_by_role('button', name='保存备注', exact=True)).to_be_disabled()
    note.fill('')
    expect(benchmark.get_by_role('button', name='保存备注', exact=True)).to_be_enabled()
    benchmark.get_by_role('button', name='保存备注', exact=True).click()
    capture_grid(page, report, 'benchmark', benchmark)
    report['interactions'].append('benchmark group/post dialogs, local save, favorite filter and save/clear note')


def verify_html_create(page, report):
    navigate(page, 'projects', 'html-video')
    create = page.locator('[data-html-video-create-page=true]')
    create.get_by_role('tab', name='AI 创作', exact=True).click()
    capture_grid(page, report, 'html-create-ai', create)
    create.get_by_role('tab', name='粘贴文案', exact=True).click()
    create.get_by_role('textbox', name='文案', exact=True).fill('这是一段本地验收文案，用于检查 HTML 视频创建控件和页面切换。')
    create.get_by_role('checkbox', name='生成前景图', exact=True).uncheck()
    create.get_by_role('spinbutton', name='场景上限', exact=True).fill('3')
    capture_grid(page, report, 'html-create-paste', create)
    create.get_by_role('button', name='开始生成', exact=True).click()
    studio = page.locator('[data-html-video-studio=html-video]')
    expect(studio).to_be_visible()
    capture_grid(page, report, 'html-studio', studio)
    tabs = studio.get_by_role('tablist', name='HTML 动画视频内容', exact=True)
    for tab in tabs.get_by_role('tab').all():
        tab.click()
        expect(tab).to_have_attribute('aria-selected', 'true')
    first = tabs.get_by_role('tab').first
    first.focus()
    first.press('End')
    expect(tabs.get_by_role('tab').last).to_be_focused()
    tabs.get_by_role('tab').last.press('Home')
    expect(first).to_be_focused()
    report['interactions'].append('HTML create AI/paste modes, standard fields, local draft task and Fluent tab keyboard focus')


def verify_new_task(page, report):
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.locator('.new-task-button').click()
    task = page.locator('.new-task-scroll')
    tabs = task.get_by_role('tablist', name='新建任务步骤', exact=True)

    def stage(value):
        tabs.locator(f'[data-tab-value={value}]').click()
        expect(task).to_have_attribute('data-new-task-stage', value)

    stage('creative')
    title = task.get_by_role('textbox', name='任务标题', exact=True)
    copy = task.get_by_role('textbox', name='文案内容', exact=True)
    title.fill('控件验收：创作流程状态保留')
    copy.fill('这是本地控件验收文案。检查任务标题、正文和制作设置切换后的状态，不调用生成接口。')
    task.get_by_role('button', name='展开高级创作参数', exact=True).click()
    task.get_by_role('textbox', name='固定开头', exact=True).fill('控件验收固定开头')
    promotion = task.get_by_role('checkbox', name='带货保留', exact=True)
    promotion.check()
    task.get_by_role('button', name='收起高级创作参数', exact=True).click()
    stage('output')
    task.get_by_role('spinbutton', name='目标字数', exact=True).fill('800')
    task.get_by_role('spinbutton', name='目标分镜数', exact=True).fill('20')
    task.get_by_role('tablist', name='AI 出图比例', exact=True).get_by_role('tab', name='16:9', exact=True).click()
    task.get_by_role('tablist', name='配音模型', exact=True).get_by_role('tab', name='MiniMax', exact=True).click()
    voice = task.get_by_role('combobox', name='配音员', exact=True)
    voice_value = voice.locator('option').last.get_attribute('value')
    voice.select_option(voice_value)
    borrow = task.get_by_role('checkbox', name='相邻镜头补位', exact=True)
    borrow.check()
    expect(task.locator('.new-task-summary')).to_contain_text('800 字')
    expect(task.locator('.new-task-summary')).to_contain_text('20 个场景')
    stage('material')
    expect(task.locator('.new-task-type-options')).to_be_visible()
    stage('creative')
    expect(title).to_have_value('控件验收：创作流程状态保留')
    expect(copy).to_have_value(re.compile('这是本地控件验收文案'))
    task.get_by_role('button', name='展开高级创作参数', exact=True).click()
    expect(task.get_by_role('textbox', name='固定开头', exact=True)).to_have_value('控件验收固定开头')
    expect(promotion).to_be_checked()
    task.get_by_role('button', name='收起高级创作参数', exact=True).click()
    task.get_by_role('button', name='保存草稿', exact=True).click()
    title.fill('已修改标题')
    task.get_by_role('button', name='恢复草稿', exact=True).click()
    expect(title).to_have_value('已修改标题')
    page.reload(wait_until='domcontentloaded')
    expect(title).to_have_value('已修改标题')
    expect(copy).to_have_value(re.compile('这是本地控件验收文案'))
    title.fill('控件验收：创作流程状态保留')
    task.get_by_role('textbox', name='预设名称', exact=True).fill('控件验收预设')
    task.get_by_role('button', name='保存为预设', exact=True).click()
    presets = task.get_by_role('combobox', name='选择创建预设', exact=True)
    expect(presets.locator('option', has_text='控件验收预设')).to_have_count(1)
    title.fill('应用预设前的改动')
    task.get_by_role('button', name='应用预设', exact=True).click()
    expect(title).to_have_value('控件验收：创作流程状态保留')
    stage('output')
    expect(voice).to_have_value(voice_value)
    expect(borrow).to_be_checked()
    expect(task.get_by_role('spinbutton', name='目标字数', exact=True)).to_have_value('800')
    task.get_by_role('button', name='删除预设', exact=True).click()
    expect(presets.locator('option', has_text='控件验收预设')).to_have_count(0)
    report['interactions'].append('new task stage switching, advanced values, autosaved draft reload/restore, preset save/apply/delete, output numbers and voice retention')
    stage('creative')
    task.get_by_role('tablist', name='素材输入方式', exact=True).get_by_role('tab', name='AI 创作', exact=True).click()
    keyword = task.get_by_role('textbox', name='关键词', exact=True)
    keyword.fill('本地验收关键词')
    web = task.get_by_role('checkbox', name='全网搜索', exact=True)
    knowledge = task.get_by_role('checkbox', name='AI 内置知识补全', exact=True)
    web.uncheck()
    knowledge.uncheck()
    expect(task.get_by_role('button', name='生成文案', exact=True)).to_be_disabled()
    knowledge.check()
    expect(task.get_by_role('button', name='生成文案', exact=True)).to_be_enabled()
    web.check()
    expect(task.locator('.web-search-provider-panel')).to_be_visible()
    channels = task.locator('.web-search-provider-grid').get_by_role('checkbox')
    for channel in channels.all():
        channel.uncheck()
    expect(task.get_by_role('button', name='搜索', exact=True)).to_be_disabled()
    channels.first.check()
    expect(task.get_by_role('button', name='搜索', exact=True)).to_be_enabled()
    task.get_by_role('tablist', name='视频形态', exact=True).get_by_role('tab', name='双人播客', exact=True).click()
    task.get_by_role('tablist', name='主播组合', exact=True).get_by_role('tab', name='刘飞 x 潇磊', exact=True).click()
    stage('output')
    expect(task.locator('.new-task-summary')).to_contain_text('liufei-xiaolei')
    expect(voice).to_have_count(0)
    stage('creative')
    task.get_by_role('tablist', name='视频形态', exact=True).get_by_role('tab', name='旁白视频', exact=True).click()
    report['interactions'].append('new task AI source and search-channel enablement, podcast controls and narration return without API calls')
    for theme in ['light', 'dark']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        for width, height in [(1440, 900), (1024, 768), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            for value in ['material', 'creative', 'output']:
                stage(value)
                task.evaluate('(n) => { n.scrollTop = 0; }')
                page.wait_for_timeout(100)
                data = metrics(page)
                name = f'new-task-{value}-{theme}-{width}.png'
                page.screenshot(path=OUTPUT / name, animations='disabled')
                report['captures'].append({'file': name, **data})
                assert not data['overflow'] and not data['regionOverflow'], (name, data)
                assert not data['rawControls'] and not data['clippedButtons'], (name, data)
                assert not data['footerOverlapsContent'], (name, data)
                if value == 'output':
                    task.get_by_role('checkbox', name='启用封面页', exact=True).check()
                    cover = task.get_by_role('tablist', name='封面图片', exact=True)
                    cover.get_by_role('tab', name='本地导入', exact=True).click()
                    expect(task.locator('[data-manual-cover-state=required]')).to_be_visible()
                    expect(task.get_by_role('button', name='导入手动封面', exact=True)).to_be_disabled()
                    for create in task.get_by_role('button', name='创建并开始生成', exact=True).all():
                        expect(create).to_be_disabled()
                    task.get_by_role('textbox', name='封面文字', exact=True).fill('本地封面标题')
                    task.locator('.ordinary-cover-page-editor').scroll_into_view_if_needed()
                    name = f'new-task-cover-{theme}-{width}.png'
                    page.screenshot(path=OUTPUT / name, animations='disabled')
                    report['captures'].append({'file': name, **metrics(page)})
                    cover.get_by_role('tab', name='AI 单独生成', exact=True).click()
                    task.get_by_role('button', name='保存草稿', exact=True).scroll_into_view_if_needed()
                    name = f'new-task-summary-{theme}-{width}.png'
                    page.screenshot(path=OUTPUT / name, animations='disabled')
                    report['captures'].append({'file': name, **metrics(page)})
    report['interactions'].append('new task standard controls across 3 stages and 3 widths in light/dark, manual-cover requirement and disabled real generation')


def seed_queue(page):
    page.evaluate('''() => {
      const key = 'storydream-history-governance-v1';
      const envelope = JSON.parse(localStorage.getItem(key));
      const now = new Date().toISOString();
      envelope.state.tasks = ['running', 'paused', 'pending', 'failed', 'cancelled', 'completed'].map((status, i) => ({
        id: `controls-qa-${status}`, title: `控件验收 ${status}：长标题任务的分镜和媒体制作`,
        inputText: '控件验收本地样例', taskKind: 'story', taskType: 'story', processingMode: 'full-auto',
        publishMode: 'review-rewrite', status, currentStep: i, track: 'character-story', style: 'modern-film',
        speaker: '', ratio: '9:16', templateId: 'default-portrait-9-16', bgmId: '', pausePoints: [], outputDir: '',
        errorMessage: status === 'failed' ? 'Image provider API error (402): 金币余额不足；控件验收用本地错误详情。' : status === 'cancelled' ? '用户取消' : '',
        createdAt: now, completedAt: status === 'completed' ? now : null, startedAt: now, lastHeartbeatAt: now,
        mode: 'paste', aiKeyword: '', aiSources: [], selectedSources: [], extraRequirements: '',
        imagePromptReference: '', promptTemplateId: null, promptTemplateType: null, referenceImagePath: '',
        rewriteIntensity: 'standard', narrativePov: 'keep-original', keepPromotion: false,
        ttsProvider: 'volcengine', ttsSpeed: 1, step3PromptSnapshot: '',
        musicMv: {rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: ''},
        failedStep: status === 'failed' ? i : null, retryFromStep: null, artifactStatePath: '',
      }));
      envelope.state.events = [{taskId: 'controls-qa-running', type: 'step_start', step: 0,
        agent: 'Reviewer', tool: null, detail: '开始预审 · 控件验收本地事件', dataJson: null, ts: Date.now(), seq: 1}];
      localStorage.setItem(key, JSON.stringify(envelope));
    }''')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_selector('[data-theme-ready=true] .app-shell')
    page.locator('.nav-list [data-nav-view=queue][data-nav-level=primary]').click()
    page.wait_for_selector('.task-queue-row')


def verify_history(page, report):
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.locator('.nav-list [data-nav-view=queue][data-nav-level=primary]').click()
    page.locator('[data-nav-view=history]').click()
    history = page.locator('.history-page')
    rows = history.locator('.table-row')
    expect(rows).to_have_count(6)
    search = history.get_by_role('textbox', name='搜索历史记录', exact=True)
    search.fill('completed')
    expect(rows).to_have_count(1)
    search.fill('没有匹配的本地记录')
    expect(rows).to_have_count(0)
    expect(history.get_by_text('暂无历史记录', exact=True)).to_be_visible()
    search.fill('')
    status = history.get_by_role('combobox', name='状态', exact=True)
    status.select_option('failed')
    expect(rows).to_have_count(1)
    expect(rows).to_contain_text('控件验收 failed')
    status.select_option('all')
    family = history.get_by_role('combobox', name='记录类型', exact=True)
    for value in ['image-lab', 'voice-lab', 'viral-analysis']:
        family.select_option(value)
        expect(history).to_have_attribute('data-history-family', value)
        expect(history.get_by_role('combobox', name='状态', exact=True)).to_have_count(0)
    family.select_option('task')
    completed = rows.filter(has_text='控件验收 completed')
    completed.get_by_role('button', name='添加收藏', exact=True).click()
    favorite = completed.get_by_role('button', name='取消收藏', exact=True)
    expect(favorite).to_have_attribute('aria-pressed', 'true')
    favorites = history.get_by_role('tablist', name='收藏范围', exact=True)
    favorites.get_by_role('tab', name='收藏任务', exact=True).click()
    expect(rows).to_have_count(1)
    favorites.get_by_role('tab', name='全部任务', exact=True).click()
    report['interactions'].append('history search, status/family filters, persisted favorite and favorite filter')
    for theme in ['light', 'dark']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        for width, height in [(1440, 900), (1024, 768), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(100)
            data = metrics(page)
            name = f'history-{theme}-{width}.png'
            page.screenshot(path=OUTPUT / name, animations='disabled')
            report['captures'].append({'file': name, **data})
            assert not data['overflow'] and not data['regionOverflow'], (name, data)
            assert not data['rawControls'] and not data['clippedButtons'], (name, data)
            scroll = history.locator('.task-history-table-scroll')
            scroll.evaluate('(n) => { n.scrollLeft = n.scrollWidth; }')
            expect(history.get_by_role('button', name='归档任务', exact=True).first).to_be_in_viewport()
            scroll.evaluate('(n) => { n.scrollLeft = 0; }')
            if width == 390:
                search.fill('没有匹配的本地记录')
                expect(history.get_by_text('暂无历史记录', exact=True)).to_be_in_viewport(ratio=1)
                search.fill('')
    page.set_viewport_size({'width': 1440, 'height': 900})
    completed.get_by_role('button', name='归档任务', exact=True).click()
    expect(rows).to_have_count(5)
    archive_tabs = history.get_by_role('tablist', name='记录范围', exact=True)
    archive_tabs.get_by_role('tab', name='已归档', exact=True).click()
    expect(rows).to_have_count(1)
    completed.get_by_role('button', name='恢复任务', exact=True).click()
    expect(rows).to_have_count(0)
    archive_tabs.get_by_role('tab', name='活跃任务', exact=True).click()
    expect(rows).to_have_count(6)
    completed.get_by_role('button', name='归档任务', exact=True).click()
    archive_tabs.get_by_role('tab', name='已归档', exact=True).click()
    report['interactions'].append('history archive and restore with table refresh')
    for theme in ['light', 'dark']:
        if page.locator('html').get_attribute('data-theme') != theme:
            page.locator('.theme-toggle').click()
        for width, height in [(1440, 900), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.wait_for_timeout(100)
            opener = completed.get_by_role('button', name='永久删除记录', exact=True)
            opener.click()
            dialog = page.get_by_role('dialog', name='永久删除记录', exact=True)
            expect(dialog).to_be_visible()
            cancel = dialog.get_by_role('button', name='取消', exact=True)
            confirm = dialog.get_by_role('button', name='永久删除', exact=True)
            expect(cancel).to_be_focused()
            contrast = button_contrast(confirm)
            assert contrast['ratio'] >= 4.5, (theme, contrast)
            confirm.hover()
            page.wait_for_timeout(150)
            hover_contrast = button_contrast(confirm)
            assert hover_contrast['ratio'] >= 4.5, (theme, hover_contrast)
            expect(dialog).to_have_attribute('aria-describedby', re.compile('.+'))
            page.keyboard.press('Shift+Tab')
            expect(confirm).to_be_focused()
            page.keyboard.press('Tab')
            expect(cancel).to_be_focused()
            name = f'history-delete-dialog-{theme}-{width}.png'
            page.screenshot(path=OUTPUT / name, animations='disabled')
            report['captures'].append({'file': name, 'dialog': True, 'contrast': contrast, 'hoverContrast': hover_contrast})
            page.keyboard.press('Escape')
            expect(dialog).not_to_be_visible()
            expect(opener).to_be_focused()
    page.set_viewport_size({'width': 1440, 'height': 900})
    opener.click()
    cancel.click()
    expect(dialog).not_to_be_visible()
    expect(opener).to_be_focused()
    opener.click()
    confirm.click()
    expect(dialog).not_to_be_visible()
    expect(rows).to_have_count(0)
    assert page.evaluate('''() => Boolean(JSON.parse(localStorage.getItem('storydream-history-governance-v1'))
      .tombstones.task['controls-qa-completed'])''')
    report['interactions'].append('history delete dialog safe initial focus, bidirectional Tab, Escape/cancel return and local permanent delete')
    # The same confirmation is also used by project and template management.
    archive_tabs.get_by_role('tab', name='活跃任务', exact=True).click()
    rows.filter(has_text='控件验收 cancelled').get_by_role('button', name='归档任务', exact=True).click()
    page.locator('.nav-list [data-nav-view=projects][data-nav-level=primary]').click()
    page.get_by_role('tablist', name='项目范围', exact=True).get_by_role('tab', name='已归档', exact=True).click()
    project_delete = page.get_by_role('button', name='永久删除', exact=True)
    project_delete.click()
    project_dialog = page.get_by_role('dialog', name='永久删除项目', exact=True)
    expect(project_dialog.get_by_role('button', name='取消', exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(project_dialog).not_to_be_visible()
    expect(project_delete).to_be_focused()
    page.locator('.nav-list [data-nav-view=prompt-templates][data-nav-level=primary]').click()
    page.locator('[data-nav-view=draft-templates]').click()
    page.locator('.draft-template-actions').first.get_by_role('button', name='复制', exact=True).click()
    page.get_by_role('button', name='返回模板列表', exact=True).click()
    template_delete = page.get_by_role('button', name=re.compile('删除自定义模板')).first
    template_delete.click()
    template_dialog = page.get_by_role('dialog', name='删除自定义模板', exact=True)
    expect(template_dialog.get_by_role('button', name='取消', exact=True)).to_be_focused()
    page.keyboard.press('Escape')
    expect(template_dialog).not_to_be_visible()
    expect(template_delete).to_be_focused()
    report['interactions'].append('shared confirmation smoke: project delete and template delete cancel/focus return')


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'captures': [], 'errors': [], 'interactions': []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        try:
            page.goto(URL, wait_until='domcontentloaded')
            page.wait_for_selector('[data-theme-ready=true] .app-shell')
            scopes = {'templates-labs': verify_templates_labs, 'benchmark': verify_benchmark, 'html': verify_html_create}
            if os.environ.get('STORYDREAM_QA_SCOPE') in scopes:
                scopes[os.environ['STORYDREAM_QA_SCOPE']](page, report)
                assert not report['errors'], report['errors']
                report['status'] = 'passed'
                return
            if os.environ.get('STORYDREAM_QA_SCOPE') == 'new-task':
                verify_new_task(page, report)
                assert not report['errors'], report['errors']
                report['status'] = 'passed'
                return
            if os.environ.get('STORYDREAM_QA_SCOPE') == 'history':
                seed_queue(page)
                verify_history(page, report)
                assert not report['errors'], report['errors']
                report['status'] = 'passed'
                return
            page.locator('.nav-list [data-nav-view=settings]').click()
            page.wait_for_selector('.settings-layout')
            for theme in ['light', 'dark']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    for section, title in [('llm', 'LLM'), ('image', 'AI 绘图'), ('tts', '旁白服务'), ('appearance', '外观')]:
                        select_section(page, section, title)
                        page.wait_for_timeout(100)
                        data = metrics(page)
                        name = f'settings-{section}-{theme}-{width}.png'
                        page.screenshot(path=OUTPUT / name, animations='disabled')
                        report['captures'].append({'file': name, **data})
                        assert not data['overflow'], (name, 'document overflow')
                        assert not data['regionOverflow'], (name, 'form overflow')
                        assert not data['rawControls'], (name, data['rawControls'])
                        assert not data['clippedButtons'], (name, data['clippedButtons'])
                        assert all(i['display'] in ['flex', 'inline-flex'] and i['innerBorder'] == '0px' for i in data['inputs']), (name, data['inputs'])
                        print(name, flush=True)
            page.set_viewport_size({'width': 1440, 'height': 900})
            select_section(page, 'llm', 'LLM')
            secret = page.locator('.config-input').filter(has=page.get_by_label('接口密钥', exact=True)).first
            secret_input = secret.locator('input')
            secret_input.fill('ui-qa-placeholder')
            secret.get_by_role('button', name='显示密钥', exact=True).click()
            expect(secret_input).to_have_attribute('type', 'text')
            secret.get_by_role('button', name='隐藏密钥', exact=True).click()
            expect(secret_input).to_have_attribute('type', 'password')
            secret.get_by_role('button', name='清除密钥', exact=True).click()
            expect(secret_input).to_have_value('')
            expect(secret.get_by_role('button', name='清除密钥', exact=True)).to_be_disabled()
            report['interactions'].append('secret reveal/hide/clear and disabled state')
            select_section(page, 'image', 'AI 绘图')
            slider = page.get_by_role('slider', name='并发', exact=True)
            before = int(slider.input_value())
            slider.focus()
            slider.press('ArrowLeft' if before == 6 else 'ArrowRight')
            expect(slider).to_have_value(str(before - 1 if before == 6 else before + 1))
            slider.press('ArrowRight' if before == 6 else 'ArrowLeft')
            report['interactions'].append('slider keyboard stepping and value update')
            for width, height in [(1440, 900), (390, 844)]:
                page.set_viewport_size({'width': width, 'height': height})
                for section, title in [('video', 'AI 视频'), ('music', '音乐创作'), ('speechToText', '语音转文字'),
                                       ('vision', '视觉分析'), ('jianying', '剪映'), ('activation', '激活与订阅'),
                                       ('creative', 'AI 创作'), ('webSearch', '联网搜索'), ('about', '关于 · 诊断')]:
                    select_section(page, section, title)
                    data = metrics(page)
                    name = f'settings-{section}-dark-{width}.png'
                    page.screenshot(path=OUTPUT / name, animations='disabled')
                    report['captures'].append({'file': name, **data})
                    assert not data['overflow'] and not data['regionOverflow'], name
                    assert not data['rawControls'] and not data['clippedButtons'], (name, data)
                    print(name, flush=True)
            page.set_viewport_size({'width': 1440, 'height': 900})
            select_section(page, 'speechToText', '语音转文字')
            checkbox = page.get_by_role('checkbox', name='段落级', exact=True)
            was_checked = checkbox.is_checked()
            checkbox.focus()
            checkbox.press('Space')
            expect(checkbox).to_be_checked(checked=not was_checked)
            checkbox.press('Space')
            report['interactions'].append('standard checkbox keyboard toggling')
            select_section(page, 'tts', '旁白服务')
            page.get_by_role('button', name='登记音色', exact=True).click()
            page.get_by_label('音色 ID', exact=True).fill('controls-first-ui-qa')
            page.get_by_label('显示名称', exact=True).fill('控件验收样例')
            page.get_by_role('button', name='保存记录', exact=True).click()
            page.get_by_role('button', name='删除音色记录 控件验收样例', exact=True).click()
            danger = page.get_by_role('button', name='确认删除音色记录 控件验收样例', exact=True)
            expect(danger).to_have_class(re.compile(r'\bfui-Button\b'))
            normal = danger.evaluate('(n) => getComputedStyle(n).backgroundColor')
            danger.hover()
            page.wait_for_timeout(150)
            hover = danger.evaluate('(n) => getComputedStyle(n).backgroundColor')
            assert normal != hover, ('danger hover state', normal, hover)
            danger.focus()
            page.keyboard.press('Tab')
            page.keyboard.press('Shift+Tab')
            expect(danger).to_be_focused()
            page.screenshot(path=OUTPUT / 'settings-danger-focus-dark.png', animations='disabled')
            danger.press('Space')
            expect(page.get_by_text('控件验收样例', exact=True)).to_have_count(0)
            report['interactions'].append('local voice create/delete, danger hover and keyboard focus')
            select_section(page, 'appearance', '外观')
            theme_tabs = page.get_by_role('tablist', name='主题', exact=True)
            light = theme_tabs.get_by_role('tab', name='浅色', exact=True)
            light.focus()
            light.press('Space')
            expect(light).to_have_attribute('aria-selected', 'true')
            expect(page.locator('html')).to_have_attribute('data-theme', 'light')
            report['interactions'].append('segmented tab keyboard activation and theme update')
            page.locator('.nav-list [data-nav-view=queue][data-nav-level=primary]').click()
            leave_dialog = page.get_by_role('dialog', name='保留未保存的改动？', exact=True)
            expect(leave_dialog).to_be_visible()
            leave_dialog.get_by_role('button', name='放弃改动并离开', exact=True).click()
            page.wait_for_selector('.task-queue-view')
            report['interactions'].append('unsaved settings navigation guard and discard')
            filters = page.get_by_role('tablist', name='任务队列筛选', exact=True)
            filters.get_by_role('tab', name='运行中', exact=True).click()
            expect(filters.get_by_role('tab', name='运行中', exact=True)).to_have_attribute('aria-selected', 'true')
            expect(page.get_by_role('button', name='刷新任务事件', exact=True)).to_be_disabled()
            report['interactions'].append('queue filter selection and disabled refresh')
            for theme in ['light', 'dark']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    data = metrics(page)
                    name = f'queue-{theme}-{width}.png'
                    page.screenshot(path=OUTPUT / name, animations='disabled')
                    report['captures'].append({'file': name, **data})
                    assert not data['overflow'] and not data['regionOverflow'], name
                    assert not data['rawControls'] and not data['clippedButtons'], name
                    expect(page.locator('.task-queue-main').get_by_text('暂无任务', exact=True)).to_be_in_viewport(ratio=1)
                    assert page.locator('.task-queue-concurrency').evaluate('(n) => n.getBoundingClientRect().height < 24'), name
            seed_queue(page)
            filters = page.get_by_role('tablist', name='任务队列筛选', exact=True)
            filters.get_by_role('tab', name='运行中', exact=True).click()
            expect(page.locator('.task-queue-row')).to_have_count(1)
            expect(page.get_by_role('button', name='暂停任务', exact=True)).to_be_disabled()
            expect(page.get_by_role('button', name='取消任务', exact=True)).to_be_disabled()
            filters.get_by_role('tab', name='等待处理', exact=True).click()
            expect(page.locator('.task-queue-row')).to_have_count(2)
            filters.get_by_role('tab', name='全部任务', exact=True).click()
            expect(page.locator('.task-queue-row')).to_have_count(6)
            report['interactions'].append('populated queue filtering, progress, events and preview-disabled actions')
            for theme in ['light', 'dark']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                for width, height in [(1440, 900), (1024, 768), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    data = metrics(page)
                    name = f'queue-populated-{theme}-{width}.png'
                    page.screenshot(path=OUTPUT / name, animations='disabled')
                    report['captures'].append({'file': name, **data})
                    assert not data['overflow'] and not data['regionOverflow'], name
                    assert not data['rawControls'] and not data['clippedButtons'], (name, data)
                    if width != 1024:
                        error_button = page.get_by_role('button', name='图片服务余额不足', exact=True)
                        error_button.focus()
                        page.keyboard.press('Enter')
                        dialog = page.get_by_role('dialog', name='控件验收 failed：长标题任务的分镜和媒体制作', exact=True)
                        expect(dialog).to_be_visible()
                        expect(page.locator('.task-queue-view')).to_be_visible()
                        close = dialog.get_by_role('button', name='关闭', exact=True)
                        expect(close).to_be_focused()
                        page.keyboard.press('Tab')
                        expect(close).to_be_focused()
                        name = f'queue-error-dialog-{theme}-{width}.png'
                        page.screenshot(path=OUTPUT / name, animations='disabled')
                        report['captures'].append({'file': name, 'dialog': True})
                        page.keyboard.press('Escape')
                        expect(dialog).not_to_be_visible()
                        expect(error_button).to_be_focused()
                        page.locator('.task-queue-table-scroll').evaluate('(n) => { n.scrollLeft = n.scrollWidth; }')
                        expect(page.get_by_role('button', name='重试任务', exact=True).first).to_be_in_viewport()
                        page.locator('.task-queue-table-scroll').evaluate('(n) => { n.scrollLeft = 0; }')
            report['interactions'].append('standard error dialog keyboard open, focus trap, Escape and focus return')
            verify_history(page, report)
            verify_new_task(page, report)
            assert not report['errors'], report['errors']
            report['status'] = 'passed'
        except Exception as error:
            report['status'] = 'failed'
            report['failure'] = str(error)
            page.screenshot(path=OUTPUT / 'failure.png')
            raise
        finally:
            payload = json.dumps(report, ensure_ascii=False, indent=2)
            (OUTPUT / 'report.json').write_text(payload, encoding='utf-8')
            scope = os.environ.get('STORYDREAM_QA_SCOPE', 'all')
            (OUTPUT / f'report-{scope}.json').write_text(payload, encoding='utf-8')
            browser.close()


if __name__ == '__main__':
    main()
