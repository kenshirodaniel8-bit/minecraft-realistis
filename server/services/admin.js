// The admins: the accounts named "daniel", "nadine", "prabu" and "shallom"
// (shared/names.js) run every server.
// In any server he joins he gets the "Player" button: everyone in the server,
// the monsters they stole and from whom, and two actions:
//   return - the stolen monster goes back to its owner (now if they are in
//            this server, otherwise the next time they play)
//   ban    - the thief is kicked and can't come back
// Only a session the server knows is the admin may use these (s.admin is set
// in Game.join from a checked identity, never from what the client says).

import { SPECIES_BY_ID } from '#shared/monsters.js';
import { isObj, int, fail } from '../validate.js';

export class Admin {
  constructor(game) {
    this.game = game;
  }

  handlePlayers(s) {
    if (!s.admin) return fail('not_admin', 'Only the admin can see this.');
    const players = [...this.game.players.values()].map((o) => ({
      pn: o.pn,
      name: o.profile.name,
      level: o.profile.level,
      monsters: o.profile.monsters.length,
      admin: !!o.admin,
      you: o === s,
      stolen: o.profile.monsters.filter((m) => m.origin === 'stolen').map((m) => ({
        ownedId: m.id, species: m.species, level: m.level, from: m.stolenFrom || '?', at: m.obtainedAt,
      })),
    }));
    return { ok: true, players };
  }

  handleReturn(s, p) {
    if (!s.admin) return fail('not_admin', 'Only the admin can do this.');
    if (!isObj(p) || !int(p.pn, 0, 1e6) || typeof p.ownedId !== 'string') return fail('bad');
    const game = this.game;
    const thief = [...game.players.values()].find((o) => o.pn === p.pn);
    if (!thief) return fail('gone', 'That player left.');
    const m = thief.profile.monsters.find((x) => x.id === p.ownedId && x.origin === 'stolen');
    if (!m) return fail('gone', 'That monster is not there any more.');
    if (game.stealing.isAway(m.id)) return fail('busy', 'Someone is stealing it right now. Try again in a moment.');
    // take it from the thief
    thief.profile.monsters = thief.profile.monsters.filter((x) => x !== m);
    const back = {
      id: m.id, species: m.species, level: m.level, obtainedAt: game.now(), origin: 'returned', slot: null, following: false,
    };
    const name = SPECIES_BY_ID[m.species]?.name || 'monster';
    const owner = [...game.players.values()].find((o) => (m.stolenFromId && o.id === m.stolenFromId) || (m.stolenFromAccount && o.account === m.stolenFromAccount));
    let deliver = null;
    if (owner) {
      back.slot = game.bases.freeSlots(owner.profile)[0] ?? null;
      owner.profile.monsters.push(back);
      game.ledger.set(back.id, owner.id, back.species, back.level);
      game.toast(owner, `🛡 The admin returned your stolen ${name}!`, 'good');
      game.refreshPerks(owner);
      game.markProfile(owner);
      game.bases.broadcastBase(owner.baseIndex);
    } else {
      // the owner is not here: it waits for them
      game.ledger.remove(back.id);
      deliver = { account: m.stolenFromAccount || null, profileId: m.stolenFromId || null, owner: m.stolenFrom || '?', monster: back };
      game.deliverLater(deliver);
    }
    game.toast(thief, `🛡 The admin gave the stolen ${name} back to ${m.stolenFrom || 'its owner'}.`, 'warn');
    game.refreshPerks(thief);
    game.markProfile(thief);
    game.bases.broadcastBase(thief.baseIndex);
    game.saveNow(thief, owner);
    game.log(`admin ${s.profile.name} returned ${m.id} from ${thief.profile.name} to ${m.stolenFrom}`);
    return { ok: true, delivered: !!owner, deliver };
  }

  handleBan(s, p) {
    if (!s.admin) return fail('not_admin', 'Only the admin can do this.');
    if (!isObj(p) || !int(p.pn, 0, 1e6)) return fail('bad');
    const game = this.game;
    const target = [...game.players.values()].find((o) => o.pn === p.pn);
    if (!target) return fail('gone', 'That player left.');
    if (target === s || target.admin) return fail('no', 'You cannot ban an admin.');
    const ban = { id: target.id, account: target.account, name: target.profile.name, by: s.profile.name, at: game.now() };
    game.addBan(ban);
    game.broadcast('announce', { text: `🛡 ${target.profile.name} was banned by the admin.`, kind: 'theft' });
    game.kick(target, 'You were banned by the admin.');
    game.log(`admin ${s.profile.name} banned ${ban.name}`);
    return { ok: true, ban: { account: ban.account, name: ban.name } };
  }
}
