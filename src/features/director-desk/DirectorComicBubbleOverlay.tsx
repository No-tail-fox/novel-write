import React from 'react';
import type { DirectorSubtitleCue } from './DirectorSubtitleInspector';
import { DirectorSubtitlePreview } from './DirectorSubtitleInspector';
import type { MotionComicBubblePosition } from '../../shared/motion-comic-dialogue';

export interface DirectorComicBubbleOverlayProps {
  cues: readonly DirectorSubtitleCue[];
  timeMs: number;
  characters?: readonly { value: string; label: string }[];
}

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string; tagBg: string }> = {
  narrative: { bg: '#1f242d', border: '#475569', text: '#e2e8f0', tagBg: '#334155' },
  linxia: { bg: '#ffffff', border: '#7c3aed', text: '#0f172a', tagBg: '#7c3aed' },
  luxun: { bg: '#ffffff', border: '#2563eb', text: '#0f172a', tagBg: '#2563eb' },
  jiangche: { bg: '#ffffff', border: '#059669', text: '#0f172a', tagBg: '#059669' },
};

function getSpeakerColor(characterId?: string, speakerName?: string, speakerRole?: string) {
  if (speakerRole === 'narrative') return ROLE_COLORS.narrative;
  const key = (characterId || speakerName || '').toLowerCase();
  if (key.includes('旁白') || key.includes('narrator')) return ROLE_COLORS.narrative;
  if (key.includes('林') || key.includes('lin')) return ROLE_COLORS.linxia;
  if (key.includes('陆') || key.includes('lu')) return ROLE_COLORS.luxun;
  if (key.includes('江') || key.includes('jiang')) return ROLE_COLORS.jiangche;

  return { bg: '#ffffff', border: '#6366f1', text: '#0f172a', tagBg: '#6366f1' };
}

function resolvePositionStyle(position?: MotionComicBubblePosition, index: number = 0): React.CSSProperties {
  if (position) {
    return {
      left: `${position.x}%`,
      top: `${position.y}%`,
      transform: 'translate(-50%, -50%)',
    };
  }

  if (index % 2 === 0) {
    return {
      left: '26%',
      top: '22%',
      transform: 'translate(-50%, 0)',
    };
  }
  return {
    right: '26%',
    top: '24%',
    transform: 'translate(50%, 0)',
  };
}

export const DirectorComicBubbleOverlay: React.FC<DirectorComicBubbleOverlayProps> = ({
  cues,
  timeMs,
  characters = [],
}) => {
  if (!cues || cues.length === 0) return null;

  const activeCues = cues.filter((cue) => {
    const isBubble = cue.bubbleStyle && cue.bubbleStyle !== 'caption';
    const isInTime = timeMs >= cue.startMs && timeMs <= cue.endMs;
    return isBubble && isInTime;
  });

  if (activeCues.length === 0) return null;

  return (
    <div
      className="director-comic-bubble-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 12,
        overflow: 'hidden',
      }}
    >
      {activeCues.map((cue, idx) => {
        const charMeta = characters.find((c) => c.value === cue.characterId);
        const displayName = cue.speakerName || charMeta?.label || (cue.speakerRole === 'narrative' ? '旁白' : '角色');
        const colors = getSpeakerColor(cue.characterId, cue.speakerName, cue.speakerRole);
        const bubbleStyle = cue.bubbleStyle || 'speech';
        const posStyle = resolvePositionStyle(cue.bubblePosition, idx);

        return (
          <div
            key={cue.id || idx}
            className={`comic-bubble-wrapper bubble-${bubbleStyle}`}
            style={{
              position: 'absolute',
              ...posStyle,
              maxWidth: '68%',
              transition: 'all 0.15s ease-out',
            }}
          >
            <div
              className="comic-bubble-box"
              style={{
                backgroundColor: colors.bg,
                borderColor: colors.border,
                color: colors.text,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  opacity: 0.9,
                }}
              >
                <span
                  style={{
                    backgroundColor: colors.tagBg,
                    color: '#ffffff',
                    padding: '1px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                  }}
                >
                  {displayName}
                </span>
                {cue.speakerRole && cue.speakerRole !== 'dialogue' && (
                  <span style={{ fontSize: 10, opacity: 0.75 }}>
                    [{cue.speakerRole === 'monologue' ? '独白' : '旁白'}]
                  </span>
                )}
                {cue.emotion && (
                  <span
                    style={{
                      fontSize: 10,
                      border: `1px solid ${colors.border}`,
                      padding: '0 4px',
                      borderRadius: 3,
                      opacity: 0.85,
                    }}
                  >
                    {cue.emotion}
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                }}
              >
                <DirectorSubtitlePreview cue={cue} timeMs={timeMs} />
              </div>
            </div>

            {bubbleStyle === 'speech' && (
              <div
                className="comic-bubble-tail"
                style={{
                  borderTopColor: colors.border,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
