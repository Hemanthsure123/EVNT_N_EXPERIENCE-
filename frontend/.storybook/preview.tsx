import * as React from 'react';
import type { Preview } from '@storybook/react';
import { fontClassNames } from '../lib/theme/fonts';
import '../styles/globals.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: 'Design system theme',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const isDark = context.globals.theme === 'dark';
      return (
        <div
          className={`${fontClassNames} ${isDark ? 'dark' : ''} bg-background text-foreground`}
          style={{ padding: '2rem', minWidth: '20rem', borderRadius: 'var(--radius-lg)' }}
        >
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
