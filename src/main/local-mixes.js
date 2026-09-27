const { normalize, radioArtist } = require('./music-tags');

// Local Mixes are deliberately hand-shaped stations, not loose genre searches.
// Seed titles identify the sound; the artist list supplies a dependable core when
// compilation or remaster metadata makes a track's release year unreliable.
const MIXES = [{
  id: 'classic-rock',
  name: 'Classic Rock',
  description: 'The guitar-driven album-rock lane from the late 1960s through 1987 — familiar essentials first, with room to explore.',
  artists: [
    'AC/DC', 'Aerosmith', 'Bad Company', 'The Beatles', 'Blue Öyster Cult', 'Boston',
    'Creedence Clearwater Revival', 'The Doors', 'Eagles', 'Fleetwood Mac', 'Foreigner',
    'The Fixx', 'Grateful Dead', 'Heart', 'Journey', 'Kansas', 'Led Zeppelin', 'Lynyrd Skynyrd',
    'Molly Hatchet', 'Nazareth', 'Pink Floyd', 'Queen', 'Rush', 'Steve Miller Band', 'Styx',
    'Supertramp', 'The Kinks', 'The Rolling Stones', 'The Who', 'Tom Petty and the Heartbreakers',
    'Tom Petty & The Heartbreakers', 'U2', 'ZZ Top'
  ],
  seeds: [
    ['Boston', 'Foreplay/Long Time'], ['Pink Floyd', 'Comfortably Numb'],
    ['Led Zeppelin', 'Ramble On'], ['Aerosmith', 'Sweet Emotion'],
    ['Eagles', 'One of These Nights'], ['Fleetwood Mac', 'The Chain'],
    ['Heart', 'Barracuda'], ['Journey', "Don't Stop Believin'"],
    ['Kansas', 'Carry On Wayward Son'], ['Tom Petty and the Heartbreakers', "Mary Jane's Last Dance"],
    ['Rush', 'Tom Sawyer'], ['Styx', 'Renegade'], ['Foreigner', 'Juke Box Hero'],
    ['The Fixx', 'One Thing Leads To Another'], ['U2', 'Sunday Bloody Sunday'],
    ['Supertramp', 'The Logical Song'], ['Creedence Clearwater Revival', 'Fortunate Son'],
    ['The Doors', 'Roadhouse Blues'], ['Queen', 'Bohemian Rhapsody'], ['Steve Miller Band', 'The Joker']
  ]
}];

const exact = (left, right) => Boolean(left && right && normalize(left) === normalize(right));
const trackArtist = track => radioArtist(track) || track?.artist || '';

function listLocalMixes() {
  return MIXES.map(({ id, name, description }) => ({ id, name, description }));
}

function resolveLocalMix(id, tracks = []) {
  const definition = MIXES.find(mix => mix.id === String(id || ''));
  if (!definition) throw new Error('That Local Mix is no longer available.');
  const seeds = definition.seeds.map(([artist, title]) => tracks.find(track =>
    exact(trackArtist(track), artist) && exact(track.title, title)
  )).filter(Boolean);
  if (seeds.length < 4) {
    throw new Error(`${definition.name} needs more of its core music in your Local Music library before it can play.`);
  }
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    artists: [...definition.artists],
    seeds
  };
}

module.exports = { listLocalMixes, resolveLocalMix, trackArtist };
