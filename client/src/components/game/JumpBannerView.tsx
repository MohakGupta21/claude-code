import type { JumpBanner } from '../../hooks/useGameAnimator';

interface Props {
  banner: JumpBanner;
  playerName: string;
  isMe: boolean;
}

export function JumpBannerView({ banner, playerName, isMe }: Props) {
  const snake = banner.kind === 'snake';
  const headline = snake ? 'Oh no!' : 'Great!';
  const who = isMe ? 'You' : playerName;
  const text = snake ? `${who} landed on a snake.` : `${who} found a ladder.`;
  return (
    <div className={`jump-banner jump-banner--${banner.kind}`} role="status">
      <span className="jump-banner-icon" aria-hidden="true">{snake ? '🐍' : '🪜'}</span>
      <div>
        <strong>{headline}</strong>
        <span>{text}</span>
        <span className="jump-banner-path">
          {banner.from} → {banner.to}
        </span>
      </div>
    </div>
  );
}
