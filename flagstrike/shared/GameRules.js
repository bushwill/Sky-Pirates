export const MAX_ROOM_CAPACITY = 10;
export const TEAM_CAPACITY = 5;
export const TEAM_SPAWN_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: -60 }),
  Object.freeze({ x: 55, y: -30 }),
  Object.freeze({ x: 70, y: 0 }),
  Object.freeze({ x: 55, y: 30 }),
  Object.freeze({ x: 0, y: 60 }),
]);

export const TEAM_GROUPS = Object.freeze([
  Object.freeze({
    id: 'red', team: 'red', label: 'Strike Team', shortLabel: 'STRIKE', siteLabel: 'STRIKE SITE',
    cssName: 'strike', accent: '#ff9b54', siteHex: 0xff8052, siteText: '#ffb18c', capacity: TEAM_CAPACITY,
  }),
  Object.freeze({
    id: 'blue', team: 'blue', label: 'Flag Team', shortLabel: 'FLAG', siteLabel: 'FLAG SITE',
    cssName: 'flag', accent: '#69baff', siteHex: 0x43b8f5, siteText: '#91d5ff', capacity: TEAM_CAPACITY,
  }),
]);

const TEAM_GROUP_BY_ID = new Map(TEAM_GROUPS.map((group) => [group.id, group]));

export function getTeamGroup(team) {
  return TEAM_GROUP_BY_ID.get(team) ?? null;
}

export function getTeamGroupId(team) {
  return TEAM_GROUP_BY_ID.has(team) ? team : null;
}
