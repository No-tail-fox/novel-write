import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { TextField } from '../../ui';
import {
  IMAGE_BUDGET_MAX_IMAGES_MAX,
  IMAGE_BUDGET_MAX_IMAGES_MIN,
  IMAGE_BUDGET_MODE_LABELS,
  IMAGE_BUDGET_MODES,
  type ImageBudgetMode,
} from '../../shared/image-budget';

/** H-5 follow-up: compact "生图张数" control (标准 / 省图 / 极省 + optional 最多 N 张) with a live estimate. */
export function ImageBudgetField({ mode, maxImages, estimate, onModeChange, onMaxImagesChange, disabled = false }: {
  mode: ImageBudgetMode;
  maxImages: string;
  /** e.g. "预计生图 8 张（约 ¥1.60）"; omitted when the plan is not known yet. */
  estimate?: string;
  onModeChange: (mode: ImageBudgetMode) => void;
  onMaxImagesChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="image-budget-field" data-image-budget-field={mode}>
      <Segmented
        label="生图张数"
        value={mode}
        options={IMAGE_BUDGET_MODES}
        labels={IMAGE_BUDGET_MODES.map((option) => IMAGE_BUDGET_MODE_LABELS[option])}
        onChange={onModeChange}
        disabled={disabled}
      />
      <TextField
        label="最多 N 张"
        hint="张（留空不限）"
        type="number"
        min={String(IMAGE_BUDGET_MAX_IMAGES_MIN)}
        max={String(IMAGE_BUDGET_MAX_IMAGES_MAX)}
        step="1"
        value={maxImages}
        placeholder="不限"
        disabled={disabled}
        onChange={(event) => onMaxImagesChange(event.target.value)}
      />
      {estimate ? <span className="hint-text" data-image-budget-estimate="">{estimate}</span> : null}
    </div>
  );
}
