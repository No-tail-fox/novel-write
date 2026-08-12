import { Field, Slider as FluentSlider } from '@fluentui/react-components';
import type { ComponentProps, ReactElement } from 'react';
import { mergeStoryDreamClasses } from './utils';

export interface SliderFieldProps extends ComponentProps<typeof FluentSlider> {
  label: string | ReactElement;
  hint?: string | ReactElement;
  valueLabel?: string | number;
  fieldClassName?: string;
}

export function SliderField({ label, hint, valueLabel, fieldClassName, className, ...props }: SliderFieldProps) {
  const fieldLabel = valueLabel !== undefined
    ? <span className="sd-field-label-row"><span>{label}</span><output>{valueLabel}</output></span>
    : label;
  return (
    <Field className={mergeStoryDreamClasses('sd-field', 'sd-slider-field', fieldClassName)} label={fieldLabel} hint={hint}>
      <FluentSlider {...props} className={mergeStoryDreamClasses('sd-slider', className)} />
    </Field>
  );
}
