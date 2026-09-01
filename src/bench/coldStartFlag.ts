/**
 * Cold-start handshake between scripts/cold-start.ts and the app.
 *
 * A cold-start number is only honest if the very first thing the fresh process
 * does is open items.db and query it — anything else (rendering a list, running
 * the matrix) warms the page cache first. The host script therefore pushes a
 * marker file, force-stops the app, and relaunches it; App.tsx checks for the
 * marker before mounting any screen and, if present, runs the measurement and
 * clears the marker.
 *
 * The marker is a one-row SQLite file rather than a plain file so the app needs
 * no filesystem native module — op-sqlite is already here.
 */

import { open } from '@op-engineering/op-sqlite';

import { DB_LOCATION } from '../db/device';

export const COLD_START_FLAG = 'coldstart.flag.db';

/** True when scripts/cold-start.ts asked for a measurement on this launch. */
export const coldStartRequested = (): boolean => {
  try {
    const db = open({
      name: COLD_START_FLAG,
      location: DB_LOCATION,
      failOnCreate: true,
    });
    db.close();
    return true;
  } catch {
    return false;
  }
};

/** Consume the marker so the next normal launch is not treated as cold. */
export const clearColdStartRequest = (): void => {
  try {
    const db = open({ name: COLD_START_FLAG, location: DB_LOCATION });
    db.delete();
  } catch {
    // Already gone — nothing to do.
  }
};
