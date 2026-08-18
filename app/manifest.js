export const dynamic = 'force-static';

export default function manifest() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const home = `${basePath}/` || '/';
  const icon = `${basePath}/Icon-60@3x.png`;

  return {
    name: '基金守望',
    short_name: '基金守望',
    description: '个人基金持仓、风险分析与交易时间提醒助手',
    start_url: home,
    scope: home,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    id: home,
    icons: [
      { src: icon, sizes: '180x180', type: 'image/png', purpose: 'any' },
      { src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ],
    categories: ['finance', 'utilities'],
    prefer_related_applications: false
  };
}
