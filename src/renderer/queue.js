const current = document.getElementById('current'), queued = document.getElementById('queued'), empty = document.getElementById('empty');
function label(track) { const box = document.createElement('div'); const title = document.createElement('div'), artist = document.createElement('div'); title.className = 'title'; artist.className = 'artist'; title.textContent = track.title || 'Untitled song'; artist.textContent = track.artist || ''; box.append(title, artist); return box; }
function render(view) { current.replaceChildren(view?.current ? label(view.current) : document.createTextNode('Nothing playing')); queued.replaceChildren(...(view?.queued || []).map(track => { const item = document.createElement('li'); item.append(label(track)); return item; })); empty.hidden = Boolean(view?.queued?.length); }
window.wavedeck.onQueueChanged(render);
void window.wavedeck.getQueueView().then(render);
