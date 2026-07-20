import { describe, expect, it } from 'vitest';
import { defaultCustomStyles } from '@shared/config';
import { defaultPromptTemplates } from '@shared/prompt-template-defaults';
import { storyboundSystemTemplates } from '@shared/storybound-system-templates';
import {
  buildImageTemplateStyleOptions,
  buildStoryTemplateOptions,
  buildTaskPromptTemplateOptions,
  buildStoryTemplateTrackOptions,
  resolvePromptTemplateDefaultDraftTemplateId,
  renderPromptTemplate,
  resolvePromptTemplateDefaultStyleId,
  resolvePromptTemplateDefaultStyleIds,
  selectStepPromptTemplate,
  selectTaskPromptTemplate,
} from '@shared/prompt-templates';

describe('prompt template rendering', () => {
  it('matches the embedded StoryDream prompt inventory', () => {
    const taskTemplates = defaultPromptTemplates.filter((template) => template.type === 'task' && template.isBuiltin);
    const globalStepTemplates = defaultPromptTemplates.filter((template) => template.type !== 'task' && template.isBuiltin);

    expect(taskTemplates.map((template) => template.id)).toEqual(storyboundSystemTemplates.map((template) => `system-${template.templateId}`));
    expect(taskTemplates.map((template) => template.name)).toEqual(storyboundSystemTemplates.map((template) => template.name));
    expect(taskTemplates.every((template) => template.stepPrompts?.rewrite && template.stepPrompts?.cover && template.stepPrompts?.storyboard && template.stepPrompts?.['image-prompt'])).toBe(true);
    expect(globalStepTemplates.map((template) => [template.id, template.type, template.name])).toEqual([
      ['builtin-review', 'review', '预审整理'],
      ['builtin-rewrite', 'rewrite', 'StoryDream 通用改写'],
      ['builtin-cover', 'cover', 'StoryDream 通用封面信息'],
      ['builtin-storyboard', 'storyboard', 'StoryDream 本地化分镜'],
      ['builtin-image-prompt', 'image-prompt', 'StoryDream 通用绘图提示词'],
    ]);
    expect(globalStepTemplates.every((template) => template.isBuiltin)).toBe(true);
    expect(taskTemplates.every((template) => template.isBuiltin)).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('模板源版本：'))).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('StoryDream 系统模板：'))).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('模板 ID：'))).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('模板说明：'))).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('默认画风：'))).toBe(true);
    expect(taskTemplates.map((template) => template.content).every((content) => content.includes('版本：'))).toBe(true);
    expect(taskTemplates.map((template) => template.stepPrompts?.storyboard).every((content) => content?.includes('JSON 字符串数组'))).toBe(true);
    expect(taskTemplates.map((template) => template.stepPrompts?.['image-prompt']).every((content) => content?.includes('分镜绘画提示词生成系统'))).toBe(true);
  });

  it('renders allowed task context placeholders and removes missing values', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: '赛道 {{track}}，正文 {{inputText}}，缺失 {{missingValue}}，要求 {{extraRequirements}}。',
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        track: 'character-story',
        inputText: '武则天十四岁入宫。',
        extraRequirements: '强调命运转折',
      },
    });

    expect(rendered).toContain('赛道 character-story');
    expect(rendered).toContain('正文 武则天十四岁入宫。');
    expect(rendered).toContain('要求 强调命运转折');
    expect(rendered).not.toContain('{{missingValue}}');
  });

  it('renders viral image prompt references in the built-in image prompt template', () => {
    const template = defaultPromptTemplates.find((item) => item.id === 'builtin-image-prompt');
    expect(template?.content).toContain('{{imagePromptReference}}');

    const rendered = renderPromptTemplate(template!, {
      task: {
        imagePromptReference: '1. 0s - 中文生图提示词：开场特写，中心构图，大字标题',
      } as never,
    });

    expect(rendered).toContain('中文生图提示词：开场特写，中心构图，大字标题');
  });

  it('renders Chinese placeholder aliases used by the template editor labels', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: '赛道 {{内容赛道}}，正文 {{原文素材}}，要求 {{额外要求}}，比例 {{画面比例}}。',
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        track: 'character-story',
        inputText: '武则天十四岁入宫。',
        extraRequirements: '强调命运转折',
        ratio: '9:16',
      },
    });

    expect(rendered).toBe('赛道 character-story，正文 武则天十四岁入宫。，要求 强调命运转折，比例 9:16。');
    expect(rendered).not.toContain('{{');
  });

  it('renders canonical local StoryDream placeholders for storyboard and image prompts', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: [
        '目标 {{targetLength}} / {{targetLengthMin}}-{{targetLengthMax}} / {{targetLengthRange}}',
        '目标分镜 {{storyboardSceneCount}}',
        '风格 {{style}} / {{stylePrefix}} / {{styleSuffix}} / {{styleAllowColor}} / {{styleNegativePrompt}}',
        '参考 {{referenceKind}} / {{referenceImagePath}} / {{imagePromptReference}}',
        '角色 {{characterCard}}',
        '种子 {{imageSeedPoolsJson}}',
        '分镜 {{scenesJson}}',
      ].join('\n'),
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        targetLength: 900,
        storyboardSceneCount: 16,
        style: 'black-white',
        referenceImagePath: 'D:/refs/person.png',
        imagePromptReference: '参考画面：近景、侧光',
      },
      taskTemplate: {
        ...defaultPromptTemplates[0],
        referenceKind: 'face',
        imageSeedPoolsJson: '{"scenes":["close","wide"]}',
      },
      artifact: {
        characterCard: {
          summary: '武则天角色档案',
          characters: [{ name: '武则天', appearance: '少年入宫', role: '主角' }],
          consistencyRules: ['保持唐代服饰'],
        },
        scenes: [{ id: 1, cap: '她十四岁入宫', descPrompt: '唐代宫门', durationMs: 1200 }],
      },
    });

    expect(rendered).toContain('目标 900 / 720-1080 / 720-1080');
    expect(rendered).toContain('目标分镜 16');
    expect(rendered).toContain('风格 black-white / 黑白纪实摄影');
    expect(rendered).toContain('/ false / 卡通，动漫');
    expect(rendered).toContain('参考 face / D:/refs/person.png / 参考画面：近景、侧光');
    expect(rendered).toContain('武则天角色档案');
    expect(rendered).toContain('"scenes":["close","wide"]');
    expect(rendered).toContain('"cap":"她十四岁入宫"');
    expect(rendered).not.toContain('{{');
  });

  it('renders custom image template style placeholders when the style library is supplied', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: '风格 {{stylePrefix}} / {{styleSuffix}} / {{styleNegativePrompt}} / {{styleAllowColor}}',
    };
    const customStyle = {
      ...defaultCustomStyles[0],
      id: 'viral-image-id',
      prefix: '爆款拆解构图公式',
      suffix: '爆款拆解光线公式',
      negativePrompt: '禁止原视频水印',
      allowColor: true,
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        style: 'viral-image-id',
      },
      customStyles: [customStyle],
    });

    expect(rendered).toBe('风格 爆款拆解构图公式 / 爆款拆解光线公式 / 禁止原视频水印 / true');
  });

  it('keeps legacy Chinese aliases usable for existing local StoryDream templates', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: [
        '目标 {{目标字数}}',
        '目标分镜 {{目标分镜数}}',
        '风格 {{当前画面风格}} / {{风格前缀}} / {{风格后缀}} / {{允许使用色彩词}} / {{负面提示词}}',
        '参考 {{参考图类型}} / {{参考图路径}} / {{生图参考}}',
        '角色 {{角色档案}}',
        '种子 {{图片种子池}}',
        '分镜 {{分镜数据}}',
      ].join('\n'),
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        targetLength: 900,
        storyboardSceneCount: 16,
        style: 'black-white',
        referenceImagePath: 'D:/refs/person.png',
        imagePromptReference: '参考画面：近景、侧光',
      },
      taskTemplate: {
        ...defaultPromptTemplates[0],
        referenceKind: 'face',
        imageSeedPoolsJson: '{"scenes":["close","wide"]}',
      },
      artifact: {
        characterCard: {
          summary: '武则天角色档案',
          characters: [{ name: '武则天', appearance: '少年入宫', role: '主角' }],
          consistencyRules: ['保持唐代服饰'],
        },
        scenes: [{ id: 1, cap: '她十四岁入宫', descPrompt: '唐代宫门', durationMs: 1200 }],
      },
    });

    expect(rendered).toContain('目标 900');
    expect(rendered).toContain('目标分镜 16');
    expect(rendered).toContain('风格 black-white / 黑白纪实摄影');
    expect(rendered).toContain('参考 face / D:/refs/person.png / 参考画面：近景、侧光');
    expect(rendered).toContain('武则天角色档案');
    expect(rendered).toContain('"scenes":["close","wide"]');
    expect(rendered).not.toContain('{{');
  });

  it('uses canonical English placeholders in the built-in StoryDream storyboard template', () => {
    const template = defaultPromptTemplates.find((item) => item.id === 'builtin-storyboard');
    const placeholders = [...(template?.content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu) ?? [])].map((match) => match[1]);

    expect([...new Set(placeholders)]).toEqual([
      'rewrittenCopy',
      'taskTemplateContent',
      'ratio',
      'style',
      'referenceKind',
      'step3SkeletonModules',
      'extraRequirements',
    ]);
    expect(template?.content).not.toMatch(/\{\{[^{}]*[\u4e00-\u9fff][^{}]*\}\}/u);
    expect(template?.content).toContain('# 分句规则 - 影视分镜级字幕拆分标准');
    expect(template?.content).toContain('JSON 字符串数组');
    expect(template?.content).toContain('尾部锚点');
    expect(template?.content).toContain('每项是该分镜在原文中的最后 10-20 个字符');
    expect(template?.content).not.toContain('Strict output shape: {"scenes"');
    expect(template?.content).not.toContain('descPrompt');
  });

  it('uses targetScenes as the effective storyboard scene count placeholder', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: 'count {{targetScenes}} / {{storyboardSceneCount}}',
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        storyboardSceneCount: 16,
        targetScenes: 18,
      },
    });

    expect(rendered).toBe('count 18 / 18');
  });

  it('puts the latest Storybound tail-anchor storyboard prompt on every built-in task template', () => {
    for (const template of defaultPromptTemplates.filter((item) => item.type === 'task' && item.isBuiltin)) {
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).toContain('# 分句规则 - 影视分镜级字幕拆分标准');
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).toContain('JSON 字符串数组');
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).not.toContain('{{targetLength');
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).not.toContain('{{targetScenes}}');
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).not.toContain('{{storyboardSceneCount}}');
      expect(template.stepPrompts?.storyboard, `${template.id}.stepPrompts.storyboard`).not.toContain('Strict output shape: {"scenes"');
    }
  });

  it('keeps target word count self-audit out of default prompt templates', () => {
    const templateLevelSelfAudit = '目标字数/目标分镜数自审';

    for (const template of defaultPromptTemplates) {
      expect(template.content, `${template.id}.content`).not.toContain(templateLevelSelfAudit);
      for (const [step, content] of Object.entries(template.stepPrompts ?? {})) {
        expect(content, `${template.id}.stepPrompts.${step}`).not.toContain(templateLevelSelfAudit);
      }
    }
  });

  it('keeps target word count constraints out of default rewrite prompt templates', () => {
    const builtinRewrite = defaultPromptTemplates.find((template) => template.id === 'builtin-rewrite');
    expect(builtinRewrite?.content).not.toContain('{{targetLength}}');
    expect(builtinRewrite?.content).not.toContain('{{targetLengthRange}}');
    expect(builtinRewrite?.content).not.toContain('Target word count range');
    expect(builtinRewrite?.content).not.toContain('Do not return rewrittenCopy outside the target word count range');

    for (const template of defaultPromptTemplates.filter((item) => item.type === 'task' && item.isBuiltin)) {
      expect(template.stepPrompts?.rewrite, `${template.id}.stepPrompts.rewrite`).not.toContain('{{targetLength}}');
      expect(template.stepPrompts?.rewrite, `${template.id}.stepPrompts.rewrite`).not.toContain('{{targetLengthRange}}');
      expect(template.stepPrompts?.rewrite, `${template.id}.stepPrompts.rewrite`).not.toContain('Target word count range');
      expect(template.stepPrompts?.rewrite, `${template.id}.stepPrompts.rewrite`).not.toContain('Do not return rewrittenCopy outside the target word count range');
    }
  });

  it('selects an explicit task template before falling back to the task track', () => {
    const explicit = {
      ...defaultPromptTemplates[0],
      id: 'custom-explicit-task',
      name: '显式模板',
      baseTrack: 'ecommerce',
      isBuiltin: false,
    };

    expect(selectTaskPromptTemplate([...defaultPromptTemplates, explicit], { track: 'character-story', promptTemplateId: explicit.id })?.id).toBe(explicit.id);
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'food-v2' })?.id).toBe('system-food-vlog');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'unknown-track' })?.id).toBe('system-general');
  });

  it('ships StoryDream system templates as built-in task defaults', () => {
    const taskTemplates = defaultPromptTemplates.filter((template) => template.type === 'task');

    expect(taskTemplates.map((template) => template.id)).toEqual([
      'system-character-story',
      'system-culture-knowledge',
      'system-ecommerce',
      'system-folk-tale',
      'system-food-vlog',
      'system-general',
      'system-health-book',
      'system-inspirational',
      'system-picture-book',
    ]);
    expect(taskTemplates.map((template) => template.baseTrack)).toEqual([
      'character-story',
      'culture-knowledge',
      'ecommerce',
      'folk-tale',
      'food-vlog',
      'general',
      'health-book',
      'inspirational',
      'picture-book',
    ]);
  });

  it('uses StoryDream task-level prompts and metadata on the character story template', () => {
    const template = defaultPromptTemplates.find((item) => item.id === 'system-character-story');

    expect(template?.description).toBe('历史人物 / 名人传记，纪实质感与情感渲染');
    expect(template?.characterPolicy).toBe('force-extract');
    expect(template?.referenceKind).toBe('face');
    expect(template?.step3SkeletonModules).toEqual(['time-period', 'no-dialogue']);
    expect(template?.defaultStyles).toEqual(['black-white']);
    expect(template?.content).toContain('StoryDream 系统模板：人物故事');
    expect(template?.stepPrompts?.rewrite).toContain('# 对标文案改写规则');
    expect(template?.stepPrompts?.cover).toContain('# 封面标题与视频简介生成规则');
    expect(template?.stepPrompts?.['image-prompt']).toContain('# AI 分镜绘画提示词生成系统（工业级版本）');
  });

  it('resolves legacy local tracks to StoryDream task templates', () => {
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'food-v2' })?.id).toBe('system-food-vlog');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'general-story' })?.id).toBe('system-general');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'mind-soup' })?.id).toBe('system-inspirational');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'culture-science' })?.id).toBe('system-culture-knowledge');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'folk-story' })?.id).toBe('system-folk-tale');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'unknown-track' })?.id).toBe('system-general');
  });

  it('prefers custom task templates when they share a built-in content track', () => {
    const custom = {
      ...defaultPromptTemplates[0],
      id: 'custom-character-story',
      name: '人物故事 自定义',
      description: '历史人物、名人传记、纪实质感与情感渲染。',
      baseTrack: 'character-story',
      isBuiltin: false,
      origin: 'custom' as const,
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    const templates = [...defaultPromptTemplates, custom];

    expect(selectTaskPromptTemplate(templates, { track: 'character-story' })?.id).toBe(custom.id);
    expect(buildStoryTemplateOptions(templates).filter(([id]) => id.includes('character-story'))).toEqual([
      ['custom-character-story', '人物故事 自定义', '历史人物、名人传记、纪实质感与情感渲染'],
      ['system-character-story', '人物故事', '历史人物 / 名人传记，纪实质感与情感渲染'],
    ]);
    expect(buildStoryTemplateTrackOptions(templates).find(([track]) => track === 'character-story')).toEqual([
      'character-story',
      '人物故事 自定义',
      '历史人物、名人传记、纪实质感与情感渲染',
    ]);
  });

  it('builds a story option for every task template instead of replacing same-track templates', () => {
    const custom = {
      ...defaultPromptTemplates[0],
      id: 'custom-character-story-123',
      name: '人物故事123',
      description: '历史人物、名人传记、纪实质感与情感渲染',
      baseTrack: 'character-story',
      isBuiltin: false,
      origin: 'custom' as const,
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    const options = buildStoryTemplateOptions([...defaultPromptTemplates, custom]);

    expect(options).toContainEqual(['custom-character-story-123', '人物故事123', '历史人物、名人传记、纪实质感与情感渲染']);
    expect(options).toContainEqual(['system-character-story', '人物故事', '历史人物 / 名人传记，纪实质感与情感渲染']);
  });

  it('builds explicit task prompt choices for the selected content track', () => {
    const custom = {
      ...defaultPromptTemplates[0],
      id: 'custom-character-story',
      name: '人物故事 自定义',
      description: '按用户保存的自定义人物叙事规则生成。',
      baseTrack: 'character-story',
      isBuiltin: false,
      origin: 'custom' as const,
      updatedAt: '2026-06-08T12:00:00.000Z',
    };

    const options = buildTaskPromptTemplateOptions([...defaultPromptTemplates, custom], 'character-story');

    expect(options.map(([id]) => id).slice(0, 2)).toEqual(['custom-character-story', 'system-character-story']);
    expect(options).toContainEqual(['custom-character-story', '人物故事 自定义', '按用户保存的自定义人物叙事规则生成']);
    expect(options.some(([id]) => id === 'system-health-book')).toBe(false);
  });

  it('selects built-in step templates by template type', () => {
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'review')?.id).toBe('builtin-review');
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'storyboard')?.id).toBe('builtin-storyboard');
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'image-prompt')?.id).toBe('builtin-image-prompt');
  });

  it('prefers the newest independent custom step template over the built-in step template', () => {
    const builtinRewrite = defaultPromptTemplates.find((template) => template.id === 'builtin-rewrite')!;
    const olderCustom = {
      ...builtinRewrite,
      id: 'custom-rewrite-old',
      name: 'Older rewrite',
      content: 'older custom rewrite',
      isBuiltin: false,
      origin: 'custom' as const,
      updatedAt: '2026-06-08T00:00:00.000Z',
    };
    const newestCustom = {
      ...builtinRewrite,
      id: 'custom-rewrite-new',
      name: 'Newest rewrite',
      content: 'newest custom rewrite',
      isBuiltin: false,
      origin: 'custom' as const,
      updatedAt: '2026-06-09T00:00:00.000Z',
    };

    expect(selectStepPromptTemplate([...defaultPromptTemplates, olderCustom, newestCustom], 'rewrite')?.id).toBe('custom-rewrite-new');
  });

  it('selects task-level AI step prompts before global step templates', () => {
    const taskTemplate = {
      ...defaultPromptTemplates[0],
      id: 'custom-task-with-step-prompts',
      stepPrompts: {
        rewrite: '只用于这个任务模板的改写规则：{{reviewedText}}',
      },
    };

    const selected = selectStepPromptTemplate(defaultPromptTemplates, 'rewrite', taskTemplate);

    expect(selected?.id).toBe('custom-task-with-step-prompts:rewrite');
    expect(renderPromptTemplate(selected!, { reviewedText: '事实简稿' })).toContain('只用于这个任务模板的改写规则：事实简稿');
  });

  it('normalizes story template default styles to stable image template ids', () => {
    const legacyTemplate = {
      ...defaultPromptTemplates[0],
      defaultStyles: ['写实彩色', '黑白摄影', 'unknown-style'],
    };

    expect(resolvePromptTemplateDefaultStyleIds(legacyTemplate)).toEqual(['photo-real', 'black-white']);
    expect(resolvePromptTemplateDefaultStyleId(legacyTemplate)).toBe('photo-real');
    expect(resolvePromptTemplateDefaultStyleId({ ...legacyTemplate, defaultStyles: [] })).toBe('photo-real');
  });

  it('normalizes StoryDream default style ids to stable local image template ids', () => {
    const storyboundTemplate = {
      ...defaultPromptTemplates[0],
      defaultStyles: ['realistic', 'oil-painting', 'vintage-film', 'folk-tale-gongbi'],
    };

    expect(resolvePromptTemplateDefaultStyleIds(storyboundTemplate)).toEqual(['photo-real', 'oil-paint', 'retro-film', 'folk']);
  });

  it('resolves custom image template ids when the current style library is supplied', () => {
    const template = {
      ...defaultPromptTemplates[0],
      defaultStyles: ['cyber-rain'],
    };

    expect(resolvePromptTemplateDefaultStyleId(template, ['cyber-rain'])).toBe('cyber-rain');
    expect(resolvePromptTemplateDefaultStyleIds(template, ['cyber-rain'])).toEqual(['cyber-rain']);
  });

  it('ships the global default image templates from the template center', () => {
    const ids = defaultCustomStyles.map((style) => style.id);

    expect(ids).toEqual([
      'cinematic',
      'ancient-cinematic',
      'black-white',
      'photo-real',
      'oil-paint',
      'modern-film',
      'ancient-film',
      'retro-film',
      'watercolor',
      'magazine',
      'pixar-3d',
      'ink',
      'folk',
      'ghibli',
    ]);
  });

  it('binds each built-in story template to exactly one resolved default image template', () => {
    const taskTemplates = defaultPromptTemplates.filter((template) => template.type === 'task');

    expect(taskTemplates).toHaveLength(9);
    for (const template of taskTemplates) {
      expect(resolvePromptTemplateDefaultStyleIds(template), template.id).toHaveLength(1);
    }
  });

  it('builds new-task content track choices from story templates', () => {
    const custom = {
      ...defaultPromptTemplates[0],
      id: 'custom-urban-myth',
      name: '都市奇谈',
      description: '都市悬疑、反转、夜间氛围。',
      baseTrack: 'urban-myth',
      isBuiltin: false,
    };

    expect(buildStoryTemplateTrackOptions([...defaultPromptTemplates, custom])).toContainEqual(['urban-myth', '都市奇谈', '都市悬疑、反转、夜间氛围']);
  });

  it('builds new-task image style choices from image templates', () => {
    const customStyle = {
      ...defaultCustomStyles[0],
      id: 'cyber-rain',
      name: '赛博雨夜',
      tag: '霓虹街景',
      description: '适合科技悬疑和都市题材。',
    };

    expect(buildImageTemplateStyleOptions([...defaultCustomStyles, customStyle])).toContainEqual(['cyber-rain', '赛博雨夜', '霓虹街景']);
  });

  it('resolves a story template default draft template when available', () => {
    const template = {
      ...defaultPromptTemplates[0],
      defaultDraftTemplateId: 'builtin-landscape-16-9',
    };

    expect(resolvePromptTemplateDefaultDraftTemplateId(template, ['default-portrait-9-16', 'builtin-landscape-16-9'])).toBe('builtin-landscape-16-9');
    expect(resolvePromptTemplateDefaultDraftTemplateId(template, ['default-portrait-9-16'])).toBe('default-portrait-9-16');
  });
});
