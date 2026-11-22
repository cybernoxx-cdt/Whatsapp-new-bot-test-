import { createCatalogPlugin } from './_catalog.js';
export default createCatalogPlugin({
  name: 'modgame',
  aliases: ['gameapk', 'modgames', 'androidgame'],
  description: 'Search and find Mod Android Games',
  base: 'https://shadow-get-mod-api.lakshandamayantha592.workers.dev',
  searchEndpoint: 'search',
  mode: 'modgame'
});
