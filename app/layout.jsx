import { Toaster } from '@/components/ui/sonner';
import './globals.css';
import KeepScreenAwake from './components/KeepScreenAwake';
import PwaRegister from './components/PwaRegister';
import ThemeColorSync from './components/ThemeColorSync';
import ClientErrorBoundary from './components/ClientErrorBoundary';
import GlobalClientErrorHandler from './components/GlobalClientErrorHandler';
import { QueryClientProviderWrapper } from './providers/query-client-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import packageJson from '../package.json';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata = {
  title: `基金守望 V${packageJson.version}`,
  description: '个人基金持仓、风险分析与交易时间提醒助手',
  manifest: `${basePath}/manifest.webmanifest`
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="基金守望" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href={`${basePath}/Icon-60@3x.png?v=1`} />
        <link rel="apple-touch-icon" sizes="180x180" href={`${basePath}/Icon-60@3x.png?v=1`} />
        {/* 初始为暗色；ThemeColorSync 会按 data-theme 同步为亮/暗 */}
        <meta name="theme-color" content="#0f172a" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* 尽早设置 data-theme，减少首屏主题闪烁；与 suppressHydrationWarning 配合避免服务端/客户端 html 属性不一致报错 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`
          }}
        />
      </head>
      <body>
        <ThemeColorSync />
        <KeepScreenAwake />
        <PwaRegister />
        <QueryClientProviderWrapper>
          <TooltipProvider>
            <ClientErrorBoundary toastTitle="页面渲染异常" toastId="app-render-error" closeModals>
              {children}
            </ClientErrorBoundary>
          </TooltipProvider>
        </QueryClientProviderWrapper>
        <Toaster />
        <GlobalClientErrorHandler />
      </body>
    </html>
  );
}
