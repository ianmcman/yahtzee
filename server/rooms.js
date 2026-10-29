const crypto = require('node:crypto');
const game = require('../site/game.js');
const { totals } = require('../site/score.js');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanName(name) {
  if (typeof name !== 'string') {
    throw httpError(400, 'Name must be a string');
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw httpError(400, 'Name cannot be empty');
  }
  return trimmed.slice(0, 20);
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function createRoomStore(options = {}) {
  const rng = options.rng;
  const now = options.now || (() => Date.now());
  const onFinish = options.onFinish;

  const rooms = new Map();

  function generateCode() {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        const randIndex = crypto.randomInt(0, ALPHABET.length);
        code += ALPHABET[randIndex];
      }
    } while (rooms.has(code));
    return code;
  }

  function getRoom(code) {
    if (!code || typeof code !== 'string') {
      throw httpError(404, 'Room not found');
    }
    const normalized = code.toUpperCase();
    const room = rooms.get(normalized);
    if (!room) {
      throw httpError(404, 'Room not found');
    }
    return room;
  }

  function notifySubscribers(room) {
    if (!room.subscribers) return;
    for (const sub of room.subscribers) {
      try {
        sub();
      } catch (err) {
        // Ignore subscriber errors
      }
    }
  }

  function create(name, userId = null) {
    const validName = cleanName(name);
    const code = generateCode();
    const token = generateToken();

    const room = {
      code,
      phase: 'lobby',
      players: [
        { name: validName, token, userId }
      ],
      game: null,
      lastActivity: now(),
      subscribers: new Set()
    };

    rooms.set(code, room);
    return { code, token };
  }

  function join(code, name, userId = null) {
    const room = getRoom(code);
    if (room.phase !== 'lobby') {
      throw httpError(409, 'Cannot join game in progress');
    }
    if (room.players.length >= 4) {
      throw httpError(409, 'Room is full');
    }
    if (userId != null && room.players.some(p => p.userId === userId)) {
      throw httpError(409, 'You are already in this room');
    }
    const validName = cleanName(name);
    const token = generateToken();

    room.players.push({ name: validName, token, userId });
    room.lastActivity = now();

    notifySubscribers(room);
    return { token };
  }

  function start(code, token) {
    const room = getRoom(code);
    const playerIndex = room.players.findIndex(p => p.token === token);
    if (playerIndex === -1) {
      throw httpError(403, 'Invalid token');
    }
    if (playerIndex !== 0) {
      throw httpError(403, 'Only the host can start the game');
    }
    if (room.phase !== 'lobby') {
      throw httpError(409, 'Game already started');
    }
    if (room.players.length < 2) {
      throw httpError(409, 'Need at least 2 players to start');
    }

    room.phase = 'playing';
    room.game = game.newGame(room.players.map(p => p.name));
    room.lastActivity = now();

    notifySubscribers(room);
  }

  function reportFinish(room) {
    if (!onFinish || room.reported) return;
    room.reported = true;
    try {
      onFinish({
        endedAt: now(),
        players: room.players.map((p, i) => {
          const card = room.game.players[i].card;
          return {
            userId: p.userId,
            name: p.name,
            total: totals(card).total,
            yahtzees: (card.yahtzee === 50 ? 1 : 0) + (card.yahtzeeBonus || 0),
          };
        }),
      });
    } catch (err) {
      // Recording a result must never break the game itself
    }
  }

  function isRanked(room) {
    return new Set(room.players.filter(p => p.userId != null).map(p => p.userId)).size >= 2;
  }

  function act(code, token, action) {
    const room = getRoom(code);
    const playerIndex = room.players.findIndex(p => p.token === token);
    if (playerIndex === -1) {
      throw httpError(403, 'Invalid token');
    }
    if (room.phase !== 'playing') {
      throw httpError(409, 'Game is not in playing phase');
    }
    if (playerIndex !== room.game.current) {
      throw httpError(409, 'Not your turn');
    }
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw httpError(400, 'Malformed action');
    }

    try {
      if (action.type === 'roll') {
        if (rng) {
          game.roll(room.game, rng);
        } else {
          game.roll(room.game);
        }
      } else if (action.type === 'hold') {
        if (typeof action.index !== 'number' || !Number.isInteger(action.index)) {
          throw new Error('Invalid die index');
        }
        game.toggleHold(room.game, action.index);
      } else if (action.type === 'score') {
        if (typeof action.category !== 'string') {
          throw new Error('Invalid category');
        }
        game.score(room.game, action.category);
        if (game.isOver(room.game)) {
          room.phase = 'over';
          reportFinish(room);
        }
      } else {
        throw new Error('Unknown action type');
      }
    } catch (err) {
      throw httpError(400, err.message);
    }

    room.lastActivity = now();
    notifySubscribers(room);
  }

  function view(code, token) {
    const room = getRoom(code);
    const playerIndex = room.players.findIndex(p => p.token === token);
    if (playerIndex === -1) {
      throw httpError(403, 'Invalid token');
    }

    return {
      code: room.code,
      phase: room.phase,
      ranked: isRanked(room),
      players: room.players.map(p => ({ name: p.name })),
      you: playerIndex,
      host: playerIndex === 0,
      game: room.game ? JSON.parse(JSON.stringify(room.game)) : null
    };
  }

  function subscribe(code, fn) {
    const room = getRoom(code);
    room.subscribers.add(fn);
    return () => {
      room.subscribers.delete(fn);
    };
  }

  function sweep() {
    const currentTime = now();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    for (const [code, room] of rooms.entries()) {
      if (currentTime - room.lastActivity > twoHoursMs) {
        rooms.delete(code);
      }
    }
  }

  return {
    create,
    join,
    start,
    act,
    view,
    subscribe,
    sweep
  };
}

module.exports = {
  createRoomStore
};
