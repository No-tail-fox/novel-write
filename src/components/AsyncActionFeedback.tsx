import type { AsyncActionFeedback as Feedback } from '../ui/async-action';

export interface AsyncActionFeedbackProps {
  feedback: Feedback | null;
}

export function AsyncActionFeedback({ feedback }: AsyncActionFeedbackProps) {
  if (!feedback) return null;
  return (
    <div className={`inline-action-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
      <span>{feedback.message}</span>
    </div>
  );
}
