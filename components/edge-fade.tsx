import { View } from 'react-native';

// Soft fade laid over the top or bottom edge of a scroll area so content dissolves
// into the background instead of being cut off. Uses React Native's native CSS
// gradient (New Architecture), so it's one smooth surface with no banding.
const STOPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function EdgeFade({ color, edge, height = 40 }: {
  color: string;               // the background color behind the scroll area (hex)
  edge: 'top' | 'bottom';
  height?: number;
}) {
  const [r, g, b] = hexToRgb(color);
  // Solid at the edge, clear toward the content, eased so there's no visible band.
  const stops = STOPS.map(t => {
    const fromEdge = edge === 'top' ? t : 1 - t;
    const alpha = Math.pow(1 - fromEdge, 1.6);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)}) ${Math.round(t * 100)}%`;
  }).join(', ');

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 0, right: 0, height,
        [edge]: 0,
        experimental_backgroundImage: `linear-gradient(to bottom, ${stops})`,
      }}
    />
  );
}
