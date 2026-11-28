import type { MissileLock } from './simulation';

export const SILO_TRIGGER_RADIUS = 500;
export const SILO_DEPLOY_SECONDS = 2.4;
// The head clears the open hatch halfway through the deployment stroke.
export const SILO_EXPOSED = .5;

export interface SiloTurret {
	deployment: number;
	shotsFired: number;
	missileLock?: MissileLock | undefined;
	targetId?: number | undefined;
}
