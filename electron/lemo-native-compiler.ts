import ts from 'typescript';
import type { VoxCompileResult } from '../src/shared/vox-animation';

/** Compile inline native film modules, binding only the pinned local Lemo/Three dependencies. */
export function compileLemoNative(source: string): VoxCompileResult {
  source = source.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  const fail = (message: string): never => { throw new Error('LEMO_CODE: ' + message); };
  if (!source || source.length > 500000) fail('全片源码应为 1–500000 字符。');
  if (!/<html[\s>]/i.test(source) || !/<head[\s>]/i.test(source) || !/<body[\s>]/i.test(source)) fail('请返回完整 HTML 文档。');
  if (/<(?:iframe|object|embed|base)\b|<meta[^>]+http-equiv\s*=\s*["']?(?:refresh|content-security-policy)|<link\b/i.test(source)) fail('页面只能使用内嵌样式、脚本与已提供的本地资源。');
  if (/(?:src|href)\s*=\s*["']\s*(?:https?:|file:|javascript:|\/\/)|(?:url\(\s*["']?\s*|@import\s+)["']?(?:https?:|file:|\/\/)/i.test(source)) fail('请内嵌资源，不引用网络或文件路径。');
  let count = 0;
  const compiled = source.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_tag, attrs: string, script: string) => {
    if (/\bsrc\s*=/i.test(attrs)) fail('影片脚本必须内嵌。');
    const typeMatch = attrs.match(/\btype\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/i);
    const type = (typeMatch?.[1] ?? typeMatch?.[2])?.toLowerCase();
    if (type && !['module','text/javascript','application/javascript'].includes(type)) {
      if (type === 'importmap') fail('使用宿主提供的 three 和 core/lib.js，不覆盖依赖。');
      return `<script${attrs}>${script}</script>`;
    }
    count++;
    const file = ts.createSourceFile('film.js', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const id = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
        if (!['three','./core/lib.js','../core/lib.js','/core/lib.js','core/lib.js'].includes(id)) fail(`不支持的依赖：${id}。请内嵌影片专用代码。`);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) fail('不支持外部重新导出。');
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) fail('不支持动态导入。');
      if (ts.isCallExpression(node) && /^(?:Math\.random|Date\.now|performance\.now)$/.test(node.expression.getText(file))) fail('请使用时间参数与带种子的随机数，确保任意帧可复现。');
      ts.forEachChild(node, visit);
    };
    visit(file);
    const result = ts.transpileModule(script, { fileName: 'film.js', reportDiagnostics: true, compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
    if (errors.length) fail(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    const code = type === 'module' ? `(async()=>{const exports={};const module={exports};const require=id=>window.LemoHost.require(id);\n${result.outputText}\n})().catch(window.LemoHost.fail);` : result.outputText;
    return `<script nonce="storydream-html-video">${code.replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  if (!count || !/(?:window|globalThis)\.render\s*=/.test(source) || !/(?:window|globalThis)\.READY\s*=/.test(source) || !/(?:window|globalThis)\.DUR\s*=/.test(source)) fail('缺少 window.render(t)、window.READY 或 window.DUR 原生协议。');
  return { source, compiled, engine: 'lemo-native' };
}
