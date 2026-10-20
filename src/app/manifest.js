export default function manifest() {
  return {
    name: 'JRouter - AI Infrastructure Management',
    short_name: 'JRouter',
    description: 'One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    orientation: 'any',
    icons: [
      {
        src: '/brand/jrouter.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
