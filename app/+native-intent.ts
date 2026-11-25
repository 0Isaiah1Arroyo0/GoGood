import { getShareExtensionKey } from 'expo-share-intent';

// When someone shares a post to Go Good (Share → Go Good in Instagram, TikTok,
// Safari…), iOS opens the app with a special link. Send it to the recipe importer,
// which picks up the shared link or text and imports it right away.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/social-recipe-import?shared=1';
    return path;
  } catch {
    return '/';
  }
}
