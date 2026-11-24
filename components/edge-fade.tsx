import { View } from 'react-native';

// Soft fade laid over the top or bottom edge of a scroll area so content dissolves
// into the background instead of being cut off. Uses React Native's native CSS
// gradient (New Architecture), so it's one smooth surface with no banding.
const STOPS = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const SOLID = 0.25; // share of the fade that stays fully solid at the edge

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function EdgeFade({ color, edge, height = 48 }: {
  color: string;               // the background color behind the scroll area (hex)
  edge: 'top' | 'bottom';
  height?: number;
}) {
  const [r, g, b] = hexToRgb(color);
  // Solid at the edge, clear toward the content, eased so there's no visible band.
  const stops = STOPS.map(t => {
    const fromEdge = edge === 'top' ? t : 1 - t;
    // Fully solid for the first stretch so the edge where the list is clipped is never
    // visible, then an eased (smoothstep) fade to clear.
    const u = Math.min(1, Math.max(0, (fromEdge - SOLID) / (1 - SOLID)));
    const alpha = 1 - u * u * (3 - 2 * u);
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
