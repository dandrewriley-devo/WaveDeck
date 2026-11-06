const current = document.getElementById('current'), next = document.getElementById('next'), nextSource = document.getElementById('nextSource'), queued = document.getElementById('queued'), empty = document.getElementById('empty');
const breakStatus = document.getElementById('breakStatus'), clipStatus = document.getElementById('clipStatus'), breakPacket = document.getElementById('breakPacket');
function label(track) { const box = document.createElement('div'); const title = document.createElement('div'), artist = document.createElement('div'); title.className = 'title'; artist.className = 'artist'; title.textContent = track.title || 'Untitled song'; artist.textContent = track.artist || ''; box.append(title, artist); return box; }
function render(view) {
  current.replaceChildren(view?.current ? label(view.current) : document.createTextNode('Nothing playing'));
  next.replaceChildren(view?.next ? label(view.next) : document.createTextNode(view?.choosing ? 'Choosing…' : 'No selection yet'));
  nextSource.textContent = view?.next?.source || '';
  breakStatus.textContent = view?.break?.status || 'Waiting for music';
  const clips = view?.break?.clips;
  clipStatus.textContent = clips ? `Outro: ${clips.outro ? 'ready' : 'missing'} · Station ID: ${clips.id ? 'ready' : 'missing'} · Intro: ${clips.intro ? 'ready' : 'missing'}` : '';
  const packet = view?.break?.packet;
  breakPacket.textContent = packet ? `Preloaded: ${packet.outro} → ${packet.id}${packet.extra ? ` → ${packet.extra}` : ''} → ${packet.intro}` : '';
  queued.replaceChildren(...(view?.queued || []).map(track => { const item = document.createElement('li'); item.append(label(track)); return item; }));
  empty.hidden = Boolean(view?.queued?.length);
}
window.wavedeck.onQueueChanged(render);
void window.wavedeck.getQueueView().then(render);
setInterval(() => void window.wavedeck.getQueueView().then(render).catch(() => {}), 5000);
