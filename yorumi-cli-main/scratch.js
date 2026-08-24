import { fetchAllAnimeStreams } from './src/allanime.js';

(async () => {
  const streams = await fetchAllAnimeStreams('Sousou no Frieren', 1, 'sub');
  console.log(JSON.stringify(streams, null, 2));
})();
