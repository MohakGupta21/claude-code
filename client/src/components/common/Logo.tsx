export function Logo({ small = false }: { small?: boolean }) {
  return (
    <a href="/" className={`logo${small ? ' logo--small' : ''}`} aria-label="Snakes & Ladders home">
      <span className="logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="logo-text">
        Snakes <span className="logo-amp">&</span> Ladders
      </span>
    </a>
  );
}
