import { Redirect } from 'expo-router';

// Any link the app doesn't recognise (an old share link, a mistyped deep link)
// goes to the start screen instead of Expo Router's debug sitemap.
export default function NotFound() {
  return <Redirect href="/" />;
}
