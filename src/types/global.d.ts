/// <reference types="next" />
/// <reference types="next/image-types/global" />

declare module "*.svg" { const src: string; export default src; }
declare module "*.png" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
declare module "*.webp" { const src: string; export default src; }
declare module "*.css";
declare module "telegram/sessions/index.js";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    [key: string]: any;
  }
  interface Navigator {
    connection?: any;
    mozConnection?: any;
    webkitConnection?: any;
    standalone?: boolean;
    setAppBadge?: (contents?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
    [key: string]: any;
  }
  interface Error {
    code?: string | number;
    status?: number;
    statusCode?: number;
    errno?: number;
    syscall?: string;
    detail?: string;
    details?: any;
    body?: any;
    retryAfter?: number;
    [key: string]: any;
  }
  interface NotificationOptions {
    renotify?: boolean;
    timestamp?: number;
    vibrate?: number[];
    actions?: any[];
    [key: string]: any;
  }
  interface Node {
    [key: string]: any;
  }
  interface Element {
    [key: string]: any;
  }
  interface HTMLElement {
    [key: string]: any;
  }
  interface EventTarget {
    [key: string]: any;
  }
  interface CSSStyleDeclaration {
    webkitTouchCallout?: string;
    [key: string]: any;
  }
  interface Blob {
    name?: string;
    lastModified?: number;
  }
}

declare module "react" {
  interface CSSProperties {
    [key: string]: any;
  }
  interface SVGProps<T> {
    strokeLinecap?: any;
    strokeLinejoin?: any;
  }
  interface KeyboardEvent<T = Element> {
    isComposing?: boolean;
  }
}

export {};
