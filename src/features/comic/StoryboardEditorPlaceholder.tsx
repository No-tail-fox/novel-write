import { Pane, Toolbar, Button, IconButton } from '../ui';
import { Plus, Trash2, ChevronLeft, ChevronRight, Play } from 'lucide-react';

/**
 * 分镜编辑器组件原型
 * 遵循 StoryDream Design Tokens 规范
 */
export function StoryboardEditorPlaceholder() {
  return (
    <div className="storyboard-editor" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%',
      backgroundColor: 'var(--panel)'
    }}>
      {/* 顶部工具栏 */}
      <Toolbar style={{ borderBottom: '1px solid var(--line)', padding: '8px var(--sd-page-inset)' }}>
        <div style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>漫剧分镜工作区</div>
        <Button variant="primary" icon={<Play size={16} />}>一键全部生成</Button>
      </Toolbar>

      {/* 中间工作区：画布 + 属性 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Pane type="workspace" style={{ flex: 1, padding: 'var(--sd-page-inset)', overflowY: 'auto' }}>
          <div style={{ 
            height: '400px', 
            border: '2px dashed var(--line)', 
            borderRadius: 'var(--sd-radius)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--muted)'
          }}>
            画布区域 - 将在此展示分镜画面
          </div>
        </Pane>

        <Pane type="inspector" style={{ width: '300px', borderLeft: '1px solid var(--line)', padding: '16px' }}>
          <h3 style={{ color: 'var(--text)', marginBottom: '16px' }}>分镜属性</h3>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--sd-text-caption)' }}>
            请在下方时间轴选中一个分镜以查看属性
          </div>
        </Pane>
      </div>

      {/* 底部时间轴 */}
      <div style={{ 
        height: '160px', 
        backgroundColor: 'var(--panel-2)', 
        borderTop: '1px solid var(--line)',
        padding: '12px var(--sd-page-inset)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <IconButton icon={<ChevronLeft size={20} />} variant="subtle" />
        
        {/* 分镜卡片占位 */}
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ 
            width: '120px', 
            height: '100%', 
            background: 'var(--panel-3)', 
            borderRadius: 'var(--sd-radius)',
            border: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text)'
          }}>
            <span>分镜 {i}</span>
          </div>
        ))}

        <Button variant="subtle" icon={<Plus size={16} />} style={{ height: '100%' }}>添加</Button>
        <IconButton icon={<Trash2 size={16} />} variant="subtle" />
      </div>
    </div>
  );
}
