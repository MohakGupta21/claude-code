import type { PlayerView } from '../../../../shared/types';
import { COLOR_HEX, COLOR_LABEL, initial } from '../../lib/players';

interface TokenBadgeProps {
  player: Pick<PlayerView, 'name' | 'color'>;
  size?: 'sm' | 'md' | 'lg';
}

/** A player's color disc with their initial — color is never the only identifier. */
export function TokenBadge({ player, size = 'md' }: TokenBadgeProps) {
  return (
    <span
      className={`token-badge token-badge--${size}`}
      style={{ '--token': COLOR_HEX[player.color] } as React.CSSProperties}
      role="img"
      aria-label={`${COLOR_LABEL[player.color]} token`}
    >
      {initial(player.name)}
    </span>
  );
}
