// Succession. The one moment the game takes the crown off your head and hands it
// to someone else — sometimes you, sometimes a stranger who happens to be your son.

import { S, ch, ti, rng, alive, newId } from '../core/state.js';
import { emit } from '../core/bus.js';
import { fullName, age, livingChildren, makeCharacter, remember } from './characters.js';
import { grantTitle, primaryTitle, TIER, recomputeVassalage } from './realm.js';

/** Ordered heir list under primogeniture-with-male-preference (the harsh default). */
export function heirsOf(charId) {
  const c = ch(charId);
  if (!c) return [];
  const kids = livingChildren(c).sort((a, b) => {
    if ((a.sex === 'm') !== (b.sex === 'm')) return a.sex === 'm' ? -1 : 1;
    return a.birthDay - b.birthDay;
  });
  if (kids.length) return kids;
  // siblings, then dynasty
  const sibs = Object.values(S.chars).filter((x) => x.deathDay == null && x.id !== charId &&
    ((c.fatherId && x.fatherId === c.fatherId) || (c.motherId && x.motherId === c.motherId)));
  if (sibs.length) return sibs.sort((a, b) => a.birthDay - b.birthDay);
  const dyn = Object.values(S.chars).filter((x) => x.deathDay == null && x.dynastyId === c.dynastyId && x.id !== charId);
  return dyn.sort((a, b) => a.birthDay - b.birthDay);
}

export function heirOf(charId) { return heirsOf(charId)[0] || null; }

export function succeed(title) {
  const dead = ch(title.holderId);
  if (!dead) return;
  const heir = heirOf(dead.id);
  if (!heir) {
    // the line ends; the title goes to whoever holds the de jure liege, else voids
    const dl = title.dejureLiege ? ti(title.dejureLiege) : null;
    if (dl?.holderId && alive(dl.holderId)) grantTitle(title.id, dl.holderId, 'escheat');
    else title.holderId = null;
    emit('title:extinct', { titleId: title.id });
    return;
  }
  grantTitle(title.id, heir.id, 'inherit');
  // brothers who got nothing remember it
  for (const s of heirsOf(dead.id).slice(1)) remember(s.id, heir.id, 'Miras ona kaldı.', -22, 40);

  if (title.holderId === heir.id && dead.id === S.playerId && !S.playerSuccessionHandled) {
    S.playerSuccessionHandled = true;
    playerDied(dead, heir);
  }
}

function playerDied(dead, heir) {
  S.pendingPlayer = heir.id;
  emit('player:died', { deadId: dead.id, heirId: heir.id });
}

/** Hand the game to the heir. Called by the UI after the player has sat with it. */
export function assumeHeir() {
  if (!S.pendingPlayer) return null;
  const id = S.pendingPlayer;
  S.pendingPlayer = null;
  S.playerSuccessionHandled = false;
  S.playerId = id;
  recomputeVassalage();
  emit('player:changed', id);
  return ch(id);
}
