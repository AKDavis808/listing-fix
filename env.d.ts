/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }
}
