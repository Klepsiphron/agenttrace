import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypedoc from 'starlight-typedoc';

export default defineConfig({
  site: 'https://klepsiphron.github.io/agenttrace/',
  base: '/agenttrace/',
  integrations: [
    starlight({
      title: 'AgentTrace',
      description: 'Local-first, privacy-first observability for AI agents',
      logo: {
        src: './src/assets/logo.svg',
        replacesTitle: false,
      },
      favicon: '/favicon.svg',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/Klepsiphron/agenttrace' },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'theme-color',
            content: '#0f172a',
          },
        },
      ],
      customCss: [
        './src/styles/custom.css',
      ],
    }),
    starlightTypedoc({
      entryPoints: ['../../packages/sdk/src/index.ts'],
      tsconfig: '../../packages/sdk/tsconfig.json',
      output: 'sdk-reference/api',
      sidebar: { label: 'API (Auto)', collapsed: true },
    }),
  ],
});
