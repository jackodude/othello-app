Consider buying me a coffee to support me :)
https://buymeacoffee.com/jackmaddocq

# Othello v1.0.0

### I got fed up of <ins>none</ins> of the Othello / Reversi apps in App Stores working correctly, having cross-platform functionality or allowing people to play at their own pace - **so I built my own!**

**This is the first public release of my simple Othello (Reversi) web app allowing you to play against friends on Apple (iOS) / Android / Desktop without a time limit!**

**Note - To enable push notifications, 'install' the site as an app on your phone and enable push notifications in the app, and within your phone settings (if disabled by default).**

See how to 'install' as an app below:
+ [Apple / iOS ](https://support.apple.com/en-gb/guide/iphone/iphea86e5236/ios)
+ [Android](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid) (Can be done on any Android browser that supports web apps e.g. Chrome, Brave...etc...)

# Play Now - Access here!
### [Othello Web App](https://othello-app.jpmaddocks.workers.dev/)

# How To

- Before starting any games, I recommend setting your player name in **Settings > Edit Profile**.
- Create a game by clicking **New Game** and then sharing the invite code with a friend.
- They can enter it in the join game box at the top to begin playing against you!


## Features

- Async two-player gameplay
- Passwordless invitations
- Multiple simultaneous games
- Player display names
- Game library
- Waiting-game cancellation
- Active-game forfeiting
- Rematches
- Home rematch inbox
- Match statistics
- Push notifications
- Progressive Web App (PWA)
- Disc animations
- Responsive mobile-first interface

## Built with

- React
- TypeScript
- Cloudflare Workers
- Cloudflare D1
- Vite


## Screenshots

<details>
  <summary>Image 1 - In-Game Play</summary>
      <img width="780" height="1634" alt="image" src="https://github.com/user-attachments/assets/aaeef574-f61b-4be5-a471-a58f48deb4c3" />;
 </details>

<details>
  <summary>Image 2 - Completed Game</summary>
<img width="775" height="1652" alt="image" src="https://github.com/user-attachments/assets/2de8adc3-8ab4-4242-b66b-a62e0b8a0326" />;
 </details>

<details>
  <summary>Image 3 - Homescreen and Stats</summary>
<img width="778" height="1575" alt="image" src="https://github.com/user-attachments/assets/85018950-9e3e-4e41-a15e-8675ef90b238" />
 </details>




# Building your own
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Push notification setup

Web Push is optional. Normal game creation, joining, polling, and moves continue
to work when VAPID settings are absent.

Generate VAPID keys:

```sh
npx @pushforge/builder vapid
```

For local development, provide the public key, private JWK, and subject through
Wrangler environment configuration. The private key must not be committed.

```sh
wrangler secret put VAPID_PRIVATE_KEY
```

Set non-secret public configuration for the Worker environment:

```sh
VAPID_PUBLIC_KEY=<public key from the generator>
VAPID_SUBJECT=mailto:you@example.com
```

For production, set the private key as a Cloudflare secret:

```sh
wrangler secret put VAPID_PRIVATE_KEY
```

Configure `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` as Worker variables in the
Cloudflare dashboard or Wrangler environment configuration. `VAPID_SUBJECT`
must be a valid `mailto:` or HTTPS contact value.

## Test controls

The test-only skip-to-end control is disabled unless the Worker variable
`ENABLE_TEST_CONTROLS` is set to `true`.

For local testing, run Wrangler with that variable in your local environment:

```sh
ENABLE_TEST_CONTROLS=true npm run dev
```

Do not configure `ENABLE_TEST_CONTROLS` for normal production gameplay.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
