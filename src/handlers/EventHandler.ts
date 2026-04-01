import fs from 'fs';
import path from 'path';
import * as GlitchTip from '@sentry/node';
import type { Client } from '@fluxerjs/core';
import type { BotEvent } from '../types';

export default class EventHandler {
  client: Client;
  events = new Map<string, BotEvent>();

  constructor(client: Client) {
    this.client = client;
  }


  async loadEvents(): Promise<void> {
    const eventsPath = path.join(__dirname, '..', 'events');

    if (!fs.existsSync(eventsPath)) {
      console.warn('Events directory not found, creating...');
      fs.mkdirSync(eventsPath, { recursive: true });
      return;
    }

    const eventFiles = fs.readdirSync(eventsPath)
      .filter(file => (file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts'));

    for (const file of eventFiles) {
      try {
        const eventPath = path.join(eventsPath, file);
        const imported = require(eventPath);
        const event: BotEvent = imported.default || imported;

        if (!event.name) {
          console.warn(`Event in ${file} is missing a name, skipping...`);
          continue;
        }

        if (event.once) {
          this.client.once(event.name, (...args: unknown[]) => {
            try {
              const result = event.execute(...args, this.client);
              if (result && typeof (result as any).catch === 'function') {
                (result as any).catch((err: Error) => {
                  GlitchTip.captureException(err, { tags: { event: event.name } });
                  console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
                });
              }
            } catch (err) {
              GlitchTip.captureException(err, { tags: { event: event.name } });
              console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
            }
          });
        } else {
          this.client.on(event.name, (...args: unknown[]) => {
            try {
              const result = event.execute(...args, this.client);
              if (result && typeof (result as any).catch === 'function') {
                (result as any).catch((err: Error) => {
                  GlitchTip.captureException(err, { tags: { event: event.name } });
                  console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
                });
              }
            } catch (err) {
              GlitchTip.captureException(err, { tags: { event: event.name } });
              console.error(`[GlitchTip] Unhandled error in event ${event.name}:`, err);
            }
          });
        }

        this.events.set(event.name, event);

      } catch (error: any) {
        console.error(`Error loading event ${file}:`, error.message);
      }
    }
  }


  getEvent(name: string): BotEvent | undefined {
    return this.events.get(name);
  }
}
