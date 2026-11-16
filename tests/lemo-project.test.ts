import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { assembleLemoProject, lemoProjectFiles, type LemoProject } from '../src/shared/creative-animation/native-project';
import { validateLemoFile } from '../electron/lemo-file-validation';
import { compileLemoNative } from '../electron/lemo-native-compiler';

describe('factory assembly integrity and continuous time', () => {
  it('accepts and executes hoisted helpers declared after the complete factory return', async () => {
    const source = 'return {render, texts}; function render(t){return twice(t);} function texts(t){return [{text:String(t)}];} function twice(t){return 2*t;}';
    expect(() => validateLemoFile(source, 'scene')).not.toThrow();
    const factory = vm.runInNewContext('(async function(){' + source + '})');
    const api = await factory();
    expect(api.render(3)).toBe(6);
    expect(api.texts(4)).toEqual([{text: '4'}]);
    expect(() => validateLemoFile('return {draw}; function draw(){return 7;}', 'shared')).not.toThrow();
  });
  it.each(['const unreachable=1;', 'class Unreachable {}', 'draw();', 'if (true) { return {}; }'])('rejects executable statements after the factory return: %s', tail => {
    expect(() => validateLemoFile('return {render(){},texts(){}}; ' + tail, 'scene')).toThrow('LEMO_FILE_INCOMPLETE');
  });
  it('identifies unreachable initialization precisely, including a second trailing return', () => {
    const source = 'return {fields}; const fields={radial(){}}; return {fields};';
    expect(() => validateLemoFile(source, 'shared')).toThrow('const fields=');
    expect(() => validateLemoFile(source, 'shared')).toThrow('移到最终 return');
    expect(() => validateLemoFile('const fields={}; return {fields}; function draw(){};', 'shared')).not.toThrow();
  });
  it('still rejects truncated hoisted helpers and missing scene APIs', () => {
    expect(() => validateLemoFile('return {render, texts}; function render(){} function texts(){', 'scene')).toThrow('LEMO_');
    expect(() => validateLemoFile('return {render}; function render(){}', 'scene')).toThrow('LEMO_FILE_CONTRACT');
  });
  it.each(['return {', 'const x = 1;', 'return {render(){}};'])('rejects incomplete scene factories: %s', source => expect(() => validateLemoFile(source, 'scene')).toThrow('LEMO_'));
  it.each([false, true])('passes absolute nonsequential time through the visible canvas (sample=%s) and safely embeds literals', async sample => {
    const project: LemoProject = { version: 2, materials: [], bindings: {}, files: lemoProjectFiles(['shot']), repairFileIds: [], samplePaths: [] };
    project.files = project.files.map(f => ({...f, status: 'valid', source: f.id === 'shared' ? 'return {calls: []};' : f.id === 'director' ? 'return {render(t){ scenes["scene-1"].render(t); }, texts(t){return scenes["scene-1"].texts(t);}};' : 'return {render(t){globalThis.lastTime=t;input.canvas.getContext("2d").fillRect(t);},texts(t){return [{text:input.script, t}];}};' }));
    const html = assembleLemoProject(project, { canvas: {width: 1280, height: 720}, script: '</script><script>throw Error("injected")</script>' }, 3000, sample);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    const compiled = compileLemoNative(html).compiled;
    const draws: number[] = [];
    const stage = { style: {}, dataset: {}, width: 0, height: 0, getContext: () => ({ fillRect: (t: number) => draws.push(t) }) };
    const mounted: unknown[] = [];
    const context = vm.createContext({ window: {LemoHost: {require:()=>({}), fail: (e: Error)=>{throw e;}}, LEMO_ASSETS:{}}, document: { createElement: () => stage, body: { style: {}, appendChild: (canvas: unknown) => mounted.push(canvas) }, fonts: { ready: Promise.resolve() } } });
    vm.runInContext(compiled.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1], context);
    await new Promise(resolve => setImmediate(resolve));
    expect(context.window.READY).toBe(true);
    expect(mounted).toEqual([stage]);
    expect([stage.width, stage.height]).toEqual([1280, 720]);
    for (const t of [2.9, 0, 1.2, 2.9]) { context.window.render(t); expect(context.lastTime).toBe(t); expect(context.window.TEXTS(t)[0].t).toBe(t); }
    expect(context.window.TEXTS(0)[0].text).toContain('</script>');
    expect(draws).toEqual([2.9, 0, 1.2, 2.9]);
  });
});
