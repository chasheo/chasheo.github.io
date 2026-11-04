import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkshopCombat, COMBAT } from '../src/workshop-gameplay.ts';

const idle = { moveX: 0, moveZ: 0, attack: false, dodge: false };
function advance(game, seconds, input = idle, fps = 120) {
  const events = [];
  for (let n = 0; n < Math.round(seconds * fps); n++) events.push(...game.update(1 / fps, input));
  return events;
}
function closePair() {
  const game = new WorkshopCombat();
  Object.assign(game.player, { x: 0, z: 1.15, facing: Math.PI });
  Object.assign(game.enemy, { x: 0, z: 0, facing: 0 });
  return game;
}
function waitForWindup(game, progress = 0) {
  for (let n = 0; n < 500; n++) {
    game.update(1 / 120, idle);
    if (game.enemyPhase === 'windup' && game.enemy.actionTime >= progress) return;
  }
  assert.fail('Enemy never prepared an attack');
}

test('movement is normalized, stays inside the yard and ignores long background-tab time', () => {
  const straight = new WorkshopCombat(), diagonal = new WorkshopCombat();
  for (const game of [straight, diagonal]) {
    Object.assign(game.player, { x: -2, z: 2 });
    Object.assign(game.enemy, { x: 3, z: -2 });
  }
  advance(straight, .25, { ...idle, moveX: 1 });
  advance(diagonal, .25, { ...idle, moveX: 1, moveZ: -1 });
  assert.ok(Math.abs(Math.hypot(straight.player.x + 2, straight.player.z - 2)
    - Math.hypot(diagonal.player.x + 2, diagonal.player.z - 2)) < 1e-8);
  const before = straight.player.x;
  straight.update(30, { ...idle, moveX: 1 });
  assert.ok(straight.player.x - before <= COMBAT.playerSpeed * .1 + 1e-8);
  advance(straight, 5, { ...idle, moveX: -1, moveZ: 1 });
  assert.ok(straight.player.x >= COMBAT.bounds.minX);
  assert.ok(straight.player.z <= COMBAT.bounds.maxZ);
});

test('the same input at 60 and 120 rendering fps yields the same combat state', () => {
  const a = closePair(), b = closePair();
  for (const [game, fps] of [[a, 60], [b, 120]]) {
    advance(game, .4, { ...idle, attack: true }, fps);
    advance(game, .4, { ...idle, moveX: 1, dodge: true }, fps);
    advance(game, .8, idle, fps);
  }
  assert.deepEqual(a.player, b.player);
  assert.deepEqual(a.enemy, b.enemy);
});

test('a sword strike damages once and holding attack never auto-repeats', () => {
  const game = closePair();
  const events = advance(game, 2.8, { ...idle, attack: true });
  assert.equal(game.enemy.health, 88);
  assert.equal(events.filter(e => e.type === 'hit' && e.actor === 'enemy').length, 1);
});

test('damage begins at the retargeted sword contact, after the visible anticipation', () => {
  const game = closePair();
  const anticipation = advance(game, COMBAT.playerStrikeTime - .03, { ...idle, attack: true });
  assert.equal(game.enemy.health, 100);
  assert.equal(anticipation.some(e => e.type === 'hit'), false);
  const contact = advance(game, .06);
  assert.equal(game.enemy.health, 88);
  assert.equal(contact.filter(e => e.type === 'hit' && e.actor === 'enemy').length, 1);
  assert.equal(game.player.action, 'attack', 'the follow-through remains in the attack state');
});

test('a sword strike must face and reach its target', () => {
  const facingAway = closePair();
  const missed = advance(facingAway, .5, { ...idle, attack: true, moveZ: 1 });
  assert.equal(facingAway.enemy.health, 100);
  assert.equal(missed.some(e => e.type === 'hit'), false);
  const tooFar = new WorkshopCombat();
  Object.assign(tooFar.player, { x: -3, z: 3 });
  Object.assign(tooFar.enemy, { x: 3, z: -3 });
  advance(tooFar, .5, { ...idle, attack: true });
  assert.equal(tooFar.enemy.health, 100);
});

test('a timed dodge avoids a strike even against a wall where movement cannot escape', () => {
  const game = closePair();
  Object.assign(game.player, { x: 3.5, z: 0 });
  Object.assign(game.enemy, { x: 2.35, z: 0 });
  waitForWindup(game, .51);
  assert.equal(game.player.health, 100, 'the telegraph itself causes no damage');
  const events = advance(game, .4, { ...idle, dodge: true, moveX: 1 });
  assert.equal(game.player.health, 100);
  assert.equal(events.filter(e => e.type === 'dodge').length, 1);
  assert.equal(game.canDodge, false);
});

test('dodging too early leaves the player vulnerable after its immunity window', () => {
  const game = closePair();
  Object.assign(game.player, { x: 3.5, z: 0 });
  Object.assign(game.enemy, { x: 2.35, z: 0 });
  waitForWindup(game, .15);
  const events = advance(game, .75, { ...idle, dodge: true, moveX: 1 });
  assert.equal(game.player.health, 78);
  assert.equal(events.filter(e => e.type === 'hit' && e.actor === 'player').length, 1);
});

test('victory happens once, stops enemy damage and lets the visitor walk to the entrance', () => {
  const game = closePair();
  game.enemy.health = 12;
  const events = advance(game, 1, { ...idle, attack: true });
  assert.equal(game.won, true);
  assert.equal(game.enemy.action, 'death');
  assert.equal(events.filter(e => e.type === 'victory').length, 1);
  const start = game.player.x;
  const later = advance(game, .5, { ...idle, moveX: 1 });
  assert.ok(game.player.x > start);
  assert.equal(game.player.health, 100);
  assert.equal(later.some(e => e.type === 'victory'), false);
});

test('fresh presses queue three distinct attacks and only the final stage is heavy', () => {
  const game = new WorkshopCombat();
  Object.assign(game.player,{x:-3,z:3}); Object.assign(game.enemy,{x:3,z:-1.6});
  const events=[];
  events.push(...advance(game,.2,{...idle,attack:true}));
  advance(game,.1);
  events.push(...advance(game,.5,{...idle,attack:true}));
  assert.equal(game.player.action,'attack2');
  advance(game,.2);
  events.push(...advance(game,.65,{...idle,attack:true}));
  assert.equal(game.player.action,'heavy');
  assert.deepEqual(events.filter(e=>e.type==='swing'&&e.actor==='player').map(e=>Boolean(e.heavy)),[false,false,true]);
});

test('light hits preserve the enemy attack, while a heavy strike interrupts and knocks it back', () => {
  const light=closePair();Object.assign(light.enemy,{action:'cleave',actionTime:.08});
  advance(light,.4,{...idle,attack:true});
  assert.equal(light.enemy.health,88);assert.equal(light.enemy.action,'cleave');
  const heavy=closePair();Object.assign(heavy.player,{action:'heavy',actionTime:.58});
  Object.assign(heavy.enemy,{action:'cleave',actionTime:.2});
  const before=heavy.enemy.z;const events=advance(heavy,.12);
  assert.equal(heavy.enemy.action,'stagger');assert.ok(heavy.enemy.z<before);
  assert.ok(events.some(e=>e.type==='hit'&&e.heavy));
});

test('a timed parry cancels incoming damage and creates a stronger counterattack', () => {
  const game=closePair();waitForWindup(game,.55);
  const parry=advance(game,.12,{...idle,parry:true});
  assert.equal(game.player.health,100);assert.equal(game.enemy.action,'stagger');
  assert.equal(parry.filter(e=>e.type==='parry').length,1);assert.equal(game.counterReady,true);
  advance(game,.05);advance(game,.1,{...idle,attack:true});assert.equal(game.player.action,'counter');
  const hit=advance(game,.3);assert.ok(hit.some(e=>e.type==='hit'&&e.actor==='enemy'&&e.heavy));
});

test('clicking parry just after impact restores the hit, while early parries and held buttons do not defend forever', () => {
  const late=closePair();waitForWindup(late,.64);advance(late,.04);assert.equal(late.player.health,78);
  const recovered=advance(late,.02,{...idle,parry:true});assert.equal(late.player.health,100);assert.ok(recovered.some(e=>e.type==='parry'));
  const early=closePair();waitForWindup(early,.05);advance(early,.9,{...idle,parry:true});assert.equal(early.player.health,78);
});

test('defeat freezes control until an explicit reset restores both fighters', () => {
  const game = closePair();
  game.player.health = 22;
  const events = advance(game, 3);
  assert.equal(game.lost, true);
  assert.equal(game.player.action, 'death');
  assert.equal(events.filter(e => e.type === 'defeat').length, 1);
  const { x, z } = game.player;
  advance(game, 1, { ...idle, moveX: 1, attack: true, dodge: true });
  assert.equal(game.player.x, x); assert.equal(game.player.z, z);
  game.reset();
  assert.equal(game.lost, false); assert.equal(game.won, false);
  assert.equal(game.player.health, 100); assert.equal(game.enemy.health, 100);
  assert.equal(game.player.action, 'idle');
});
