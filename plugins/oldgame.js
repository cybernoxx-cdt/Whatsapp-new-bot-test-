import { createCatalogPlugin } from './_catalog.js';
export default createCatalogPlugin({
  name: 'oldgame',
  aliases: ['pcgame', 'classicgame', 'oldpc'],
  description: 'Search classic PC games and download files',
  base: 'https://old-pcgame-by-shadow.lakshandamayantha592.workers.dev',
  searchEndpoint: 'search',
  mode: 'oldgame'
});
