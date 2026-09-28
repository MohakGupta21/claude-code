import { PLAYER_NAME_MAX_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants';
import type { ClientMessage } from '../shared/protocol';
import { Errors } from './errors';

/** Central validation for everything that arrives from a client. Assume all input is hostile. */

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function parsePlayerName(value: unknown): string {
  if (typeof value !== 'string') throw Errors.invalidInput('Please enter your name.');
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length === 0) throw Errors.invalidInput('Please enter your name.');
  if ([...name].length > PLAYER_NAME_MAX_LENGTH) {
    throw Errors.invalidInput(`Names can be at most ${PLAYER_NAME_MAX_LENGTH} characters.`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw Errors.invalidInput('Names can use letters, numbers, spaces and . _ \' -');
  }
  return name;
}

export function parseRoomCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROOM_CODE_PATTERN.test(code)) throw Errors.roomNotFound();
  return code;
}

export function isRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(value);
}

export function parsePlayerId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw Errors.invalidPlayer();
  return value;
}

export function parseToken(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw Errors.notAuthenticated();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a raw WebSocket frame into a well-formed client message, rejecting anything else. */
export function parseClientMessage(raw: string): ClientMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Errors.invalidInput('Malformed message.');
  }
  if (!isRecord(data) || typeof data.type !== 'string') throw Errors.invalidInput('Malformed message.');

  switch (data.type) {
    case 'join':
    case 'reconnect':
      return { type: data.type, playerId: parsePlayerId(data.playerId), token: parseToken(data.token) };
    case 'ready':
      if (typeof data.ready !== 'boolean') throw Errors.invalidInput('Malformed message.');
      return { type: 'ready', ready: data.ready };
    case 'start':
    case 'roll_dice':
    case 'restart':
    case 'leave':
      return { type: data.type };
    default:
      throw Errors.invalidInput('Unknown action.');
  }
}
