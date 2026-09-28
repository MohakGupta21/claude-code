import { useState } from 'react';
import type { ConnectionStatus } from '../../lib/socket';
import { Logo } from './Logo';

interface RoomHeaderProps {
  roomCode: string;
  connection: ConnectionStatus;
  onLeave(): void;
}

const CONNECTION_TEXT: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  open: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Offline',
};

export function RoomHeader({ roomCode, connection, onLeave }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const link = `${location.origin}/room/${roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this invite link:', link);
    }
  };
  return (
    <header className="room-header">
      <Logo small />
      <div className="room-header-actions">
        <button type="button" className="room-code-chip" onClick={copy} aria-label={`Room code ${roomCode}. Copy invite link`}>
          <span className="room-code-chip-label">Room</span>
          <span className="room-code-chip-code">{roomCode}</span>
          <span className="room-code-chip-copy" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
        </button>
        <span className={`connection connection--${connection}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {CONNECTION_TEXT[connection]}
        </span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onLeave}>
          Leave
        </button>
      </div>
    </header>
  );
}
