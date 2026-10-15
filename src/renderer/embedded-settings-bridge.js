// Settings hosts the manager and log in isolated frames. Only the operations
// those two views need cross this small message bridge.
const embeddedWavedeck = {};
const embeddedRequests = new Map();
const embeddedListeners = new Map();
let embeddedRequestId = 0;
for (const method of [
  'getPortableMusicArtists', 'getPortableMusicArtistDetail', 'playMusic',
  'saveArtistRelationships', 'savePortableMusicReleaseHoliday', 'savePortableMusicTrack',
  'clearMusicDebugHistory', 'getMusicDebugHistory', 'saveMusicDebugLog'
]) {
  embeddedWavedeck[method] = (...args) => new Promise((resolve, reject) => {
    const id = ++embeddedRequestId;
    embeddedRequests.set(id, { resolve, reject });
    window.parent.postMessage({ type: 'embedded-request', id, method, args }, '*');
  });
}
for (const [method, name] of [
  ['onMusicDebugLog', 'debug-log'], ['onMusicDebugReset', 'debug-reset']
]) embeddedWavedeck[method] = callback => embeddedListeners.set(name, callback);

window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  const message = event.data || {};
  if (message.type === 'embedded-response') {
    const request = embeddedRequests.get(message.id);
    if (!request) return;
    embeddedRequests.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  } else if (message.type === 'embedded-event') {
    embeddedListeners.get(message.name)?.(message.data);
  }
});
