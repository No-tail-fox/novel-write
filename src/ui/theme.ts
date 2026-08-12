import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components';

export const storyDreamDarkTheme: Theme = {
  ...webDarkTheme,
  colorBrandForeground1: '#ff755f',
  colorBrandForeground2: '#f2614b',
  colorBrandBackground: '#f2614b',
  colorBrandBackgroundHover: '#ff755f',
  colorBrandBackgroundPressed: '#d94f3b',
  colorBrandBackgroundSelected: '#f2614b',
  colorNeutralBackground1: '#101214',
  colorNeutralBackground2: '#15181b',
  colorNeutralBackground3: '#1b1f23',
  colorNeutralBackground4: '#24292e',
  colorNeutralForeground1: '#f4f6f8',
  colorNeutralForeground2: '#b1b8be',
  colorNeutralForeground3: '#8e979f',
  colorNeutralStroke1: '#343a40',
  colorNeutralStroke2: '#272c31',
  colorNeutralStrokeAccessible: '#727b83',
  colorStatusSuccessForeground1: '#65b883',
  colorStatusWarningForeground1: '#e0a34c',
  colorStatusDangerForeground1: '#ff6666',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '8px',
  fontFamilyBase: 'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif',
};

export const storyDreamLightTheme: Theme = {
  ...webLightTheme,
  colorBrandForeground1: '#a92f21',
  colorBrandForeground2: '#cf3f2d',
  colorBrandBackground: '#cf3f2d',
  colorBrandBackgroundHover: '#a92f21',
  colorBrandBackgroundPressed: '#8d281d',
  colorBrandBackgroundSelected: '#cf3f2d',
  colorNeutralBackground1: '#ffffff',
  colorNeutralBackground2: '#f4f5f6',
  colorNeutralBackground3: '#eaebed',
  colorNeutralBackground4: '#dedfe1',
  colorNeutralForeground1: '#15171a',
  colorNeutralForeground2: '#626870',
  colorNeutralForeground3: '#7a8087',
  colorNeutralStroke1: '#dedfe1',
  colorNeutralStroke2: '#e8e9eb',
  colorNeutralStrokeAccessible: '#747a81',
  colorStatusSuccessForeground1: '#18734a',
  colorStatusWarningForeground1: '#805300',
  colorStatusDangerForeground1: '#a92d36',
  borderRadiusMedium: '6px',
  borderRadiusLarge: '8px',
  fontFamilyBase: 'Inter, "Segoe UI", "Microsoft YaHei UI", sans-serif',
};

export function storyDreamTheme(theme: 'dark' | 'light'): Theme {
  return theme === 'light' ? storyDreamLightTheme : storyDreamDarkTheme;
}
