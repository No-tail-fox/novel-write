import { SegmentedControl } from '../ui';
import { ASPECT_RATIOS, isAspectRatio, type AspectRatio } from '../shared/aspect-ratio';
import { AspectRatioSwatch } from './AspectRatioSwatch';

export interface AspectRatioFieldProps {
  label?: string;
  /** Preserve legacy draft strings without coercing or silently selecting a fallback. */
  value: string;
  onChange: (value: AspectRatio) => void;
  ratios?: readonly AspectRatio[];
  disabled?: boolean;
}

/** Shared presentation only: routes retain their defaults, drafts and render settings. */
export function AspectRatioField({
  label = '画幅',
  value,
  onChange,
  ratios = ASPECT_RATIOS,
  disabled = false,
}: AspectRatioFieldProps) {
  return (
    <div className="field aspect-ratio-field" data-aspect-ratio-field style={{ minWidth: 0 }}>
      <span>{label}</span>
      <SegmentedControl
        label={label}
        value={value}
        style={{ flexWrap: 'wrap', minWidth: 0 }}
        onChange={(next) => {
          if (!disabled && isAspectRatio(next) && ratios.includes(next)) onChange(next);
        }}
        options={ratios.map((ratio) => ({ value: ratio, label: ratio, icon: <AspectRatioSwatch ratio={ratio} />, disabled }))}
      />
    </div>
  );
}
