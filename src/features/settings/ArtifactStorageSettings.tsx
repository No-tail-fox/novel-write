import { useEffect, useState } from 'react';
import { FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ArtifactStorageLocation } from '../../shared/artifact-storage';
import { Button, TextField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import { LocalInfo, SettingsCard } from './settings-controls';

export function ArtifactStorageSettings({ api }: { api: StoryDreamApi }) {
  const [location, setLocation] = useState<ArtifactStorageLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const action = useAsyncAction();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void api.getArtifactStorage().then((value) => {
      if (active) setLocation(value);
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, reload]);

  function chooseDirectory() {
    void action.run(() => api.chooseArtifactStorage(), { onSuccess: setLocation });
  }

  function cancelDirectoryChange() {
    void action.run(() => api.cancelArtifactStorageChange(), { onSuccess: setLocation });
  }
  if (loading) return <div role="status" className="settings-help-text">正在读取产物存储位置…</div>;
  if (loadError) return <div className="artifact-storage-settings">
    <LocalInfo title="无法读取产物存储位置" value={loadError} />
    <Button onClick={() => setReload((value) => value + 1)}>重新读取</Button>
  </div>;
  if (!location) return <LocalInfo title="产物存储" value="请在 StoryDream 桌面端设置产物存储位置。" />;

  return <div className="artifact-storage-settings">
    <SettingsCard title="全部创作产物" status={location.migrationError ? '迁移未完成' : location.pendingDirectory ? '重启后切换' : '使用中'}>
      <p className="settings-help-text">任务文件、生成的图片、视频、音频，以及导入的受管素材和素材库统一保存在此目录。剪映草稿仍按“剪映”设置中的目录导出。</p>
      <TextField fieldClassName="config-input" label="当前存储位置" value={location.directory} readOnly title={location.directory} />
      <TextField fieldClassName="config-input" label="默认存储位置" value={location.defaultDirectory} readOnly title={location.defaultDirectory} />
      {location.pendingDirectory ? <TextField fieldClassName="config-input" label="重启后使用的位置" value={location.pendingDirectory} readOnly title={location.pendingDirectory} /> : null}
      {location.migrationError ? <div role="alert" className="test-result">迁移未完成，当前仍使用原目录。{location.migrationError} 请检查目标位置后重启重试，也可以重新选择文件夹或取消切换。</div> : null}
      <div className="button-row">
        <Button variant="primary" icon={action.busy ? <Loader2 className="spin" size={15} /> : <FolderOpen size={15} />} disabled={action.busy} onClick={chooseDirectory}>
          {location.pendingDirectory ? '重新选择文件夹' : '选择存储文件夹'}
        </Button>
        {location.pendingDirectory ? <Button icon={<RotateCcw size={15} />} disabled={action.busy} onClick={cancelDirectoryChange}>取消切换</Button> : null}
      </div>
      <AsyncActionFeedback feedback={action.feedback} />
    </SettingsCard>
    <LocalInfo title={location.pendingDirectory ? '已保存，重启后切换' : '切换方式'} value="选择后自动保存。请先完成正在进行的创作，再重启 StoryDream；启动时会复制已有产物，全部复制成功后使用新目录。原目录保留备份，同名的不同文件不会被覆盖。" />
    <p className="settings-help-text">数据库、应用设置、API 凭据和授权信息保留在原应用数据目录。</p>
  </div>;
}
