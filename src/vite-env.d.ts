/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALCHEMY_BSC_KEY?: string;
  readonly VITE_LSE_API_KEY?: string;
  readonly VITE_TELEGRAM_BOT_TOKEN?: string;
  readonly VITE_TELEGRAM_CHAT_ID?: string;
  readonly [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
