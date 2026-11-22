import { createCatalogPlugin } from './_catalog.js';
export default createCatalogPlugin({
  name: 'modapk',
  aliases: ['apkmod', 'apksearch', 'modapps'],
  description: 'Search and find Mod APK download links',
  base: 'https://shadow-get-mod-api.lakshandamayantha592.workers.dev',
  searchEndpoint: 'search',
  mode: 'app'
});
