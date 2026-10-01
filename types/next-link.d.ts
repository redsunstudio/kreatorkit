// next/link's public (pages-router) typings don't declare the app-router-only
// `unstable_dynamicOnHover` prop, though app-dir Link reads it at runtime
// (next/dist/client/app-dir/link.js). It upgrades the link to a full prefetch
// on hover/touch, so the page is usually cached before the click lands.
import 'next/dist/client/link';

declare module 'next/dist/client/link' {
  // Type parameters must match the original declaration exactly to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  interface LinkProps<RouteInferType = any> {
    unstable_dynamicOnHover?: boolean;
  }
}
