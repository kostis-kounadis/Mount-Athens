// @ts-check
import { defineConfig } from 'astro/config';

import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://kostis-kounadis.github.io',
  base: '/Mount-Athens/',
  integrations: [tailwind()]
});