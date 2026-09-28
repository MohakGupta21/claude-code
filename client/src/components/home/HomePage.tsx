import { useState } from 'react';
import { PLAYER_NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from '../../../../shared/constants';
import type { SessionResponse } from '../../../../shared/protocol';
import { api, ApiError } from '../../lib/api';
import { rememberedName } from '../../lib/session';
import { Logo } from '../common/Logo';
import './home.css';

interface HomePageProps {
  initialRoomCode?: string;
  notice?: string | null;
  onEnterRoom(session: SessionResponse): void;
}

type Mode = 'create' | 'join';

export function HomePage({ initialRoomCode, notice, onEnterRoom }: HomePageProps) {
  const [mode, setMode] = useState<Mode>(initialRoomCode ? 'join' : 'create');
  const [name, setName] = useState(rememberedName.get);
  const [code, setCode] = useState(initialRoomCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Please enter your name.');
    if (mode === 'join' && code.length !== ROOM_CODE_LENGTH) return setError(`Room codes have ${ROOM_CODE_LENGTH} characters.`);
    setBusy(true);
    setError(null);
    try {
      const session = mode === 'create' ? await api.createGame(trimmed) : await api.joinGame(code, trimmed);
      rememberedName.set(trimmed);
      onEnterRoom(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <div className="home-hero">
        <Logo />
        <h1 className="home-title">
          Roll, climb, and slide
          <br />
          <span>with friends — live.</span>
        </h1>
        <p className="home-lead">
          Create a room, share the code, and race to square 100. Watch out for the snakes!
        </p>
        <ol className="home-steps" aria-label="How it works">
          <li><span>1</span> Create or join a room</li>
          <li><span>2</span> Wait for 2–4 players</li>
          <li><span>3</span> Take turns rolling the dice</li>
        </ol>
      </div>

      <section className="card home-card" aria-label="Play">
        <div className="segmented" role="tablist" aria-label="Create or join">
          {(['create', 'join'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'create' ? 'Create game' : 'Join game'}
            </button>
          ))}
        </div>

        {notice && <p className="notice" role="alert">{notice}</p>}

        <form onSubmit={submit} className="home-form" noValidate>
          <label className="field">
            <span className="field-label">Your name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={PLAYER_NAME_MAX_LENGTH}
              placeholder="e.g. Priya"
              autoComplete="nickname"
              autoFocus={!initialRoomCode || !name}
              required
            />
          </label>

          {mode === 'join' && (
            <label className="field">
              <span className="field-label">Room code</span>
              <input
                className="input input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH))}
                placeholder="ABC123"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                autoFocus={Boolean(initialRoomCode && name)}
                required
              />
            </label>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="btn btn--primary btn--xl" disabled={busy}>
            {busy ? 'Just a moment…' : mode === 'create' ? 'Create room' : 'Join room'}
          </button>
        </form>
      </section>
    </main>
  );
}
